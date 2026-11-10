const matcher = require("./matcher");
const tmdb = require("./tmdb");

// Stremio does not ask stream addons for the id an addon invented — when a
// title is resolved through Cinemeta (search/home/library), the stream request
// carries the Cinemeta video id instead: a movie id ("tt..."), or a series
// episode id ("tt...:season:episode"). Those ids never equal a local
// flatPath, so without IMDb resolution the addon answers {"streams":[]}, the
// client falls back to torrent addons, and every platform shows
// "Stream failed to load". This module maps Cinemeta-style ids back onto
// local files.
//
// Preferred path uses TMDB /find (exact mapping) when a token is configured.
// Without a token, Cinemeta meta gives the English title only — foreign-titled
// releases (e.g. "Shiawase Kanako no Koroshiya Seikatsu" vs "Happy Kanako's
// Killer Life") cannot always be resolved, so scoring stays conservative to
// avoid offering the wrong show.

const CINEMETA_BASE = "https://v3-cinemeta.strem.io/meta";
const CINEMETA_TTL = 60 * 60 * 1000;
const cinemetaCache = new Map();

const IMDB_ID_PATTERN = /^(tt\d+)(?::(\d+):(\d+))?$/;

function normalizeTitle(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function asyncFetchJson(url) {
  return fetch(url).then((res) => (res.ok ? res.json() : null));
}

async function fetchCinemetaMeta(type, imdbId) {
  const key = `${type}:${imdbId}`;
  const hit = cinemetaCache.get(key);
  if (hit && Date.now() - hit.t < CINEMETA_TTL) return hit.meta;
  const meta = await asyncFetchJson(`${CINEMETA_BASE}/${type}/${imdbId}.json`)
    .then((data) => data && data.meta)
    .catch(() => null);
  if (meta) cinemetaCache.set(key, { t: Date.now(), meta });
  return meta;
}

function yearOf(value) {
  const m = String(value || "").match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

// Collect every title the local filename may plausibly match against, plus a
// release year to anchor the verdict.
async function buildTitleCandidates(type, imdbId) {
  const candidates = new Set();
  let year = null;

  const meta = await fetchCinemetaMeta(type, imdbId);
  if (meta) {
    [meta.name, meta.title, meta.originalTitle, meta.original_title].forEach(
      (t) => {
        const n = normalizeTitle(t);
        if (n) candidates.add(n);
      }
    );
    year = yearOf(meta.releaseInfo || meta.year || meta.release_date || meta.first_air_date);
  }

  if (tmdb.isEnabled()) {
    const data = await tmdbFetchFind(type, imdbId);
    if (data) {
      [data.name, data.title, data.original_name, data.original_title].forEach(
        (t) => {
          const n = normalizeTitle(t);
          if (n) candidates.add(n);
        }
      );
      year = yearOf(data.release_date || data.first_air_date) || year;

      // A release named after the romanized original (or any localization) only
      // matches through TMDB's alternative-title list.
      const alt =
        type === "series"
          ? await tmdb.getTVAlternativeTitles(data.id)
          : await tmdb.getMovieAlternativeTitles(data.id);
      (alt || []).forEach((r) => {
        const n = normalizeTitle(r.title);
        if (n) candidates.add(n);
      });
    }
  }

  return { candidates: [...candidates], year };
}

async function tmdbFetchFind(type, imdbId) {
  const data = await (type === "movie" ? tmdb.findMovie(imdbId) : tmdb.findTV(imdbId));
  return data || null;
}

function scoreLocalTitle(localTitle, candidates) {
  const local = normalizeTitle(localTitle);
  let best = 0;
  for (const c of candidates) {
    let score = 0;
    if (local === c) score = 100;
    else if (local && c && (local.includes(c) || c.includes(local))) score = 60;
    else {
      const a = new Set(local.split(" "));
      const b = new Set(c.split(" "));
      const overlap = [...a].filter((w) => b.has(w)).length;
      score = Math.round((overlap / Math.max(a.size, b.size)) * 60);
    }
    if (score > best) best = score;
  }
  return best;
}

async function resolveByImdb(files, type, id) {
  const m = IMDB_ID_PATTERN.exec(id);
  if (!m) return null;

  const imdbId = m[1];
  const season = m[2] ? parseInt(m[2], 10) : null;
  const episode = m[3] ? parseInt(m[3], 10) : null;

  const pool = files.filter((f) => f.type === type);
  if (pool.length === 0) return null;

  // Group episodes by series so a title verdict picks a whole show first;
  // otherwise "Season 1 Episode 1" could poach an unrelated show's episode.
  let candidatesInScope = pool;
  if (type === "series") {
    if (season !== null) {
      const bySeasonEpisode = pool.filter(
        (f) => f.season === season && f.episode === episode
      );
      if (bySeasonEpisode.length > 0) candidatesInScope = bySeasonEpisode;
    }
    // Episode id with no season info, or no (season, episode) hit: fall back
    // to every series file and let title scoring separate shows.
  }

  const { candidates, year } = await buildTitleCandidates(type, imdbId);
  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const f of candidatesInScope) {
    const parsed = matcher.parseFilename(f.flatPath, type);
    let score = scoreLocalTitle(parsed.title, candidates);
    if (score >= 40 && year && parsed.year === year) score += 40;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    } else if (score === bestScore && best && score > 0) {
      if (f.isComplete && !best.isComplete) best = f;
      else if (f.isComplete === best.isComplete && f.size > best.size) best = f;
    }
  }

  // 60+ requires an exact or substring title match (with word-overlap awards
  // needing enough agreement); below that only a year anchor plus strong word
  // agreement is accepted — otherwise a wrong show would get offered.
  if (bestScore < 60 && !(bestScore >= 40 && year)) return null;
  return best || null;
}

module.exports = { resolveByImdb };
