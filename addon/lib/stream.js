const { FILE_SERVER_PUBLIC_URL, FILE_SERVER_API_KEY, fetchFileList } = require("./file-server");
const { fetchExternalSubtitles } = require("./subtitle");
const { parseFilename } = require("./matcher");
const { resolveByImdb } = require("./imdb");

const LANG_NAME_TO_CODE = {
  english: "eng", spanish: "spa", french: "fre", german: "ger", italian: "ita",
  portuguese: "por", russian: "rus", japanese: "jpn", korean: "kor", chinese: "chi",
  arabic: "ara", hindi: "hin", dutch: "dut", swedish: "swe", norwegian: "nor",
  danish: "dan", finnish: "fin", polish: "pol", turkish: "tur", hebrew: "heb",
  thai: "tha", vietnamese: "vie",
};

function langToCode(name) {
  return LANG_NAME_TO_CODE[name.toLowerCase()] || name;
}

function buildStreamUrl(filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const base = `${FILE_SERVER_PUBLIC_URL}/${encoded}`;
  if (FILE_SERVER_API_KEY) {
    return `${base}?key=${encodeURIComponent(FILE_SERVER_API_KEY)}`;
  }
  return base;
}

// Local sidecars arrive from /api/list as { name, path, lang }; external providers
// arrive from /api/subtitle/search with a ready-made url. Both must end up as a
// url the Stremio client can fetch — a subtitle without one never loads.
function subtitleUrl(sub, videoPath) {
  if (sub.url) return sub.url;
  if (sub.path) return buildStreamUrl(sub.path);
  if (sub.name && videoPath) {
    const dir = videoPath.split("/").slice(0, -1).join("/");
    if (dir) return buildStreamUrl(`${dir}/${sub.name}`);
  }
  return null;
}

module.exports = async function (args) {
  try {
    const files = await fetchFileList();
    let match = files.find((f) => f.flatPath === args.id);

    // Catalog/meta requests carry flatPath ids, but Cinemeta-resolved plays
    // carry "tt..." (movie) or "tt...:s:e" (series episode) ids instead.
    if (!match) {
      match = await resolveByImdb(files, args.type, args.id);
    }

    if (!match) {
      return { streams: [] };
    }

    let subs = match.subtitles || [];
    if (subs.length === 0) {
      const parsed = parseFilename(match.flatPath, match.type);
      const external = await fetchExternalSubtitles(
        parsed.title, parsed.year, match.season, match.episode
      );
      subs = external;
    }

    const stream = {
      url: buildStreamUrl(match.path),
      filename: match.flatPath,
      name: "Direct",
      description: `${(match.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
      subtitles: subs
        .map((sub, i) => ({
          id: sub.id || `sub-${i}`,
          url: subtitleUrl(sub, match.path),
          lang: langToCode(sub.lang || sub.name),
          name: sub.name || sub.lang,
        }))
        .filter((sub) => sub.url),
      behaviorHints: {
        notWebReady: true,
        filename: match.flatPath,
      },
    };

    return { streams: [stream] };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
};
