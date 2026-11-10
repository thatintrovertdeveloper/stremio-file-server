/**
 * First automated checks for the Stremio Local File Server.
 *
 * Drives the two real HTTP surfaces exactly as Stremio would:
 *   - file server  (streaming, listing, thumbnails, subtitles)   :3003
 *   - addon        (Stremio protocol: manifest/catalog/meta/stream) :7001
 *
 * The suite assumes both services are already running against the fixture media
 * tree. scripts/qa-e2e.sh owns that lifecycle.
 *
 * Env:
 *   ADDON_URL              default http://127.0.0.1:7001
 *   FILE_SERVER_URL        default http://127.0.0.1:3003
 *   FILE_SERVER_PUBLIC_URL default = FILE_SERVER_URL
 *   API_KEY                default test-key
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const ADDON = process.env.ADDON_URL || "http://127.0.0.1:7001";
const FILES = process.env.FILE_SERVER_URL || "http://127.0.0.1:3003";
const PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILES;
const KEY = process.env.API_KEY || "test-key";
const AUTH = { "X-API-Key": KEY };

const MOVIE = "Big.Buck.Bunny.2008.1080p.mp4";
const EPISODE = "Breaking.Bad.S01E01.720p.mkv";
const EPISODE_PATH = "Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.mkv";
const SHOW = "Breaking.Bad";

const json = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  return { res, body: parsed };
};

const fileList = async () => {
  const { res, body } = await json(`${FILES}/api/list`, { headers: AUTH });
  assert.equal(res.status, 200, "/api/list must return 200 with a valid key");
  return body.files;
};

const bySz = (files, name) => {
  const f = files.find((x) => x.flatPath === name);
  assert.ok(f, `expected ${name} in /api/list`);
  return f;
};

// ---------------------------------------------------------------------------
// File server — library indexing
// ---------------------------------------------------------------------------

describe("file-server: library indexing", () => {
  test("GET /health is public and reports healthy", async () => {
    const { res, body } = await json(`${FILES}/health`);
    assert.equal(res.status, 200);
    assert.equal(body.status, "healthy");
    assert.ok(body.timestamp, "health payload should carry a timestamp");
  });

  test("GET /api/list enforces the API key on all three auth paths", async () => {
    assert.equal((await fetch(`${FILES}/api/list`)).status, 401, "no key must be rejected");
    assert.equal(
      (await fetch(`${FILES}/api/list`, { headers: { "X-API-Key": "wrong" } })).status,
      401,
      "wrong key must be rejected",
    );
    assert.equal(
      (await fetch(`${FILES}/api/list`, { headers: { "X-API-Key": KEY } })).status,
      200,
      "X-API-Key header must be accepted",
    );
    assert.equal(
      (await fetch(`${FILES}/api/list`, { headers: { Authorization: `Bearer ${KEY}` } })).status,
      200,
      "Authorization: Bearer must be accepted",
    );
    assert.equal(
      (await fetch(`${FILES}/api/list?key=${encodeURIComponent(KEY)}`)).status,
      200,
      "?key= query param must be accepted",
    );
  });

  test("classifies a flat movie file as a movie", async () => {
    const movie = bySz(await fileList(), MOVIE);
    assert.equal(movie.type, "movie");
    assert.equal(movie.title, null);
    assert.equal(movie.path, MOVIE, "a movie at the library root keeps its bare name as path");
    assert.equal(movie.flatPath, movie.name, "flatPath is the bare filename");
    assert.ok(movie.size > 0);
  });

  test("classifies S01E01 and exposes season/episode", async () => {
    const ep = bySz(await fileList(), EPISODE);
    assert.equal(ep.type, "series");
    assert.equal(ep.title, SHOW, "series title comes from the top-level folder");
    assert.equal(ep.season, 1);
    assert.equal(ep.episode, 1);
    assert.equal(ep.path, EPISODE_PATH, "path keeps the directory structure for the stream URL");
    assert.equal(ep.flatPath, EPISODE, "flatPath stays the bare filename");
  });

  test("classifies the 01x01 filename form", async () => {
    const ep = bySz(await fileList(), "Dark.01x01.mkv");
    assert.equal(ep.type, "series");
    assert.equal(ep.title, "Dark");
    assert.equal(ep.season, 1);
    assert.equal(ep.episode, 1);
  });

  test("infers season/episode from a season folder when the filename only carries an episode number", async () => {
    const ep = bySz(await fileList(), "Money.Heist.E05.mkv");
    assert.equal(ep.type, "series");
    assert.equal(ep.title, "Money.Heist");
    assert.equal(ep.season, 2, "season comes from the 'Season 2' folder");
    assert.equal(ep.episode, 5, "episode comes from the E05 suffix");
  });

  test("flags partially downloaded files", async () => {
    const files = await fileList();
    assert.equal(bySz(files, "Some.Movie.2024.incomplete.mp4").isComplete, false);
    assert.equal(bySz(files, MOVIE).isComplete, true);
  });

  test("matches local subtitle sidecars by stem prefix only", async () => {
    const ep = bySz(await fileList(), EPISODE);
    const names = ep.subtitles.map((s) => s.name).sort();
    assert.deepEqual(names, [
      "Breaking.Bad.S01E01.720p.eng.srt",
      "Breaking.Bad.S01E01.720p.forced.eng.srt",
    ], "both language variants match; Other.Show.S01E01.eng.srt must not");
    for (const sub of ep.subtitles) {
      assert.equal(sub.lang, "English");
      assert.ok(sub.path.endsWith(sub.name), "subtitle path is relative to the source dir");
    }
  });
});

// ---------------------------------------------------------------------------
// File server — streaming contract
// ---------------------------------------------------------------------------

describe("file-server: streaming contract", () => {
  const url = () => `${FILES}/${EPISODE_PATH.split("/").map(encodeURIComponent).join("/")}`;

  test("HEAD advertises size, type and range support without a body", async () => {
    const files = await fileList();
    const ep = bySz(files, EPISODE);
    const res = await fetch(url(), { method: "HEAD", headers: AUTH });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(Number(res.headers.get("content-length")), ep.size);
    assert.equal(res.headers.get("content-type"), "video/x-matroska");
    assert.equal(await res.text(), "", "HEAD must not return a body");
  });

  test("honours a byte range with 206 and an exact Content-Range", async () => {
    const files = await fileList();
    const ep = bySz(files, EPISODE);
    const res = await fetch(url(), { headers: { ...AUTH, Range: "bytes=100-199" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 100-199/${ep.size}`);
    assert.equal(res.headers.get("content-length"), "100");
    const body = new Uint8Array(await res.arrayBuffer());
    assert.equal(body.byteLength, 100, "range response must be exactly 100 bytes");
  });

  test("returns the correct bytes for a range (seek correctness)", async () => {
    const files = await fileList();
    const ep = bySz(files, EPISODE);
    const full = new Uint8Array(await (await fetch(url(), { headers: AUTH })).arrayBuffer());
    const slice = new Uint8Array(
      await (await fetch(url(), { headers: { ...AUTH, Range: "bytes=1000-1099" } })).arrayBuffer(),
    );
    assert.deepEqual(Buffer.from(slice), Buffer.from(full.subarray(1000, 1100)));
  });

  test("a full GET without Range returns 200 and no Content-Range", async () => {
    // RFC 9110: 206 is for requests that carried a Range header. A player that
    // downloads the whole file should see a normal 200 response.
    const files = await fileList();
    const ep = bySz(files, EPISODE);
    const res = await fetch(url(), { headers: AUTH });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-range"), null, "Content-Range belongs to 206 responses only");
    assert.equal(res.headers.get("accept-ranges"), "bytes", "range support is still advertised");
    assert.equal(Number(res.headers.get("content-length")), ep.size);
    const body = new Uint8Array(await res.arrayBuffer());
    assert.equal(body.byteLength, ep.size, "a full GET returns the entire file");
  });

  test("a Range starting past EOF returns 416", async () => {
    const files = await fileList();
    const ep = bySz(files, EPISODE);
    const res = await fetch(url(), { headers: { ...AUTH, Range: `bytes=${ep.size}-` } });
    assert.equal(res.status, 416);
  });

  test("serves a subtitle sidecar with a text content type", async () => {
    const subUrl = `${FILES}/${encodeURIComponent("Breaking.Bad")}/${encodeURIComponent("Season 1")}/Breaking.Bad.S01E01.720p.eng.srt`;
    const res = await fetch(subUrl, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /^text\/plain/);
    assert.match(await res.text(), /English sub/);
  });

  test("generates a PNG thumbnail with ffmpeg", async () => {
    const res = await fetch(`${FILES}/api/thumbnail/${encodeURIComponent(MOVIE)}`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], "PNG magic");
  });

  test("404s an unknown file and blocks path traversal", async () => {
    assert.equal((await fetch(`${FILES}/Nope.Movie.2020.mp4`, { headers: AUTH })).status, 404);
    for (const attack of ["/../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd"]) {
      const res = await fetch(`${FILES}${attack}`, { headers: AUTH });
      assert.ok(res.status >= 400, `traversal ${attack} must not be served (got ${res.status})`);
    }
  });

  test("stream endpoints require the API key", async () => {
    assert.equal((await fetch(url())).status, 401);
    assert.equal((await fetch(`${url()}?key=${encodeURIComponent(KEY)}`)).status, 200);
  });
});

// ---------------------------------------------------------------------------
// Addon — Stremio protocol contract
// ---------------------------------------------------------------------------

describe("addon: Stremio protocol", () => {
  const catalogs = () => fetch(`${ADDON}/manifest.json`).then((r) => r.json());

  test("manifest advertises both catalogs and all three resources", async () => {
    const { res } = await json(`${ADDON}/manifest.json`);
    assert.equal(res.status, 200);
    const manifest = await catalogs();
    assert.equal(manifest.id, "org.stremio.localfileserver");
    assert.deepEqual(manifest.types, ["movie", "series"]);
    assert.deepEqual(manifest.resources.sort(), ["catalog", "meta", "stream"]);
    assert.deepEqual(manifest.catalogs.map((c) => c.id).sort(), ["local", "local"]);
    assert.deepEqual(manifest.catalogs.map((c) => c.type).sort(), ["movie", "series"]);
  });

  test("movie catalog uses flatPath as id and the public file-server URL for posters", async () => {
    const { res, body } = await json(`${ADDON}/catalog/movie/local.json`);
    assert.equal(res.status, 200);
    const movie = body.metas.find((m) => m.id === MOVIE);
    assert.ok(movie, "the fixture movie must appear in the catalog");
    assert.equal(movie.type, "movie");
    assert.equal(movie.poster, `${PUBLIC_URL}/api/thumbnail/${encodeURIComponent(MOVIE)}?key=${KEY}`);
    assert.match(movie.description, /Complete/);
  });

  test("series catalog groups episodes into one entry per show", async () => {
    const { body } = await json(`${ADDON}/catalog/series/local.json`);
    const ids = body.metas.map((m) => m.id);
    assert.equal(ids.filter((id) => id === `__series__${SHOW}`).length, 1, "one entry per show");
    const show = body.metas.find((m) => m.id === `__series__${SHOW}`);
    assert.equal(show.type, "series");
    assert.match(show.description, /^2 episodes$/);
    assert.ok(!ids.some((id) => id.includes(MOVIE)), "movies must not leak into the series catalog");
  });

  test("series meta lists every episode with flatPath ids and correct season/episode", async () => {
    const { res, body } = await json(`${ADDON}/meta/series/${encodeURIComponent(`__series__${SHOW}`)}.json`);
    assert.equal(res.status, 200);
    assert.equal(body.meta.type, "series");
    assert.equal(body.meta.id, `__series__${SHOW}`);
    assert.deepEqual(body.meta.videos.map((v) => v.id), [
      "Breaking.Bad.S01E01.720p.mkv",
      "Breaking.Bad.S01E02.720p.mkv",
    ]);
    assert.deepEqual(body.meta.videos.map((v) => [v.season, v.episode]), [[1, 1], [1, 2]]);
    assert.match(body.meta.videos[0].title, /^S01E01 - /);
  });

  test("movie stream URL is the public file-server path plus the key", async () => {
    const { res, body } = await json(`${ADDON}/stream/movie/${MOVIE}.json`);
    assert.equal(res.status, 200);
    assert.equal(body.streams.length, 1);
    assert.equal(body.streams[0].url, `${PUBLIC_URL}/${MOVIE}?key=${encodeURIComponent(KEY)}`);
    assert.equal(body.streams[0].behaviorHints.notWebReady, true);
  });

  test("episode stream URL keeps the directory path, not the flatPath", async () => {
    const { body } = await json(`${ADDON}/stream/series/${EPISODE}.json`);
    assert.equal(body.streams.length, 1);
    assert.equal(
      body.streams[0].url,
      `${PUBLIC_URL}/${EPISODE_PATH.split("/").map(encodeURIComponent).join("/")}?key=${encodeURIComponent(KEY)}`,
      "streaming by flatPath alone would break multi-directory and nested layouts",
    );
    assert.equal(body.streams[0].filename, EPISODE);
  });

  test("unknown stream id returns an empty stream list, not an error", async () => {
    const { res, body } = await json(`${ADDON}/stream/movie/Does.Not.Exist.1999.mp4.json`);
    assert.equal(res.status, 200);
    assert.deepEqual(body.streams, []);
  });

  test("Cinemeta-style stream ids fall back to empty streams without a 5xx", async () => {
    // Stremio queries addons with "tt..." ids when a title is resolved through
    // Cinemeta instead of the addon's own catalog-meta ids. The resolver must
    // treat unresolvable ids gracefully; a 5xx here shows up to Stremio as
    // "Stream failed to load" even though the local library has the file.
    for (const id of ["999:1:1", "tt9999999:99:99"]) {
      const { res, body } = await json(
        `${ADDON}/stream/series/${encodeURIComponent(id)}.json`
      );
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.streams), `empty streams array for id "${id}"`);
    }
  });

  test("every subtitle offered to Stremio carries a playable url", async () => {
    // Regression lock for F2: file-server returns local sidecars as {name, path, lang}
    // while external providers use {url}. stream.js must build a URL for both.
    const { body } = await json(`${ADDON}/stream/series/${EPISODE}.json`);
    const subs = body.streams[0].subtitles;
    assert.equal(subs.length, 2, "both local sidecars should be offered");
    for (const sub of subs) {
      assert.ok(sub.url, `subtitle "${sub.name}" has no url — Stremio cannot load it`);
      assert.ok(sub.url.startsWith(PUBLIC_URL), "subtitle url must be client-reachable");
      assert.ok(sub.url.includes("key="), "subtitle url must carry the API key");
    }
  });

  test("each offered subtitle url actually serves its sidecar", async () => {
    const { body } = await json(`${ADDON}/stream/series/${EPISODE}.json`);
    for (const sub of body.streams[0].subtitles) {
      const res = await fetch(sub.url);
      assert.equal(res.status, 200, `${sub.name} url must resolve`);
      assert.match(res.headers.get("content-type") || "", /^text\/plain/);
      assert.match(await res.text(), /-->/, "a subtitle body contains a timing cue");
    }
  });
});

// ---------------------------------------------------------------------------
// The one true end-to-end assertion: a URL handed to Stremio actually plays
// ---------------------------------------------------------------------------

describe("end-to-end: the URL Stremio receives is streamable", () => {
  test("stream url from the addon serves a range request with real bytes", async () => {
    const { body } = await json(`${ADDON}/stream/series/${EPISODE}.json`);
    const streamUrl = body.streams[0].url;

    const head = await fetch(streamUrl, { method: "HEAD" });
    assert.equal(head.status, 200, "a player probes with HEAD before playing");
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal(head.headers.get("content-type"), "video/x-matroska");

    const ranged = await fetch(streamUrl, { headers: { Range: "bytes=0-255" } });
    assert.equal(ranged.status, 206);
    const bytes = new Uint8Array(await ranged.arrayBuffer());
    assert.equal(bytes.byteLength, 256);
    assert.deepEqual(
      Array.from(bytes.subarray(0, 4)),
      [0x1a, 0x45, 0xdf, 0xa3],
      "Matroska/EBML magic — the player receives real media bytes, not a stub",
    );
  });
});
