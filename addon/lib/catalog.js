const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

const tmdb = require("./tmdb");
const matcher = require("./matcher");

function buildHeaders() {
  const headers = {};
  if (FILE_SERVER_API_KEY) {
    headers["X-API-Key"] = FILE_SERVER_API_KEY;
  }
  return headers;
}

function buildThumbUrl(filename) {
  const base = `${FILE_SERVER_PUBLIC_URL}/api/thumbnail/${encodeURIComponent(filename)}`;
  if (FILE_SERVER_API_KEY) {
    return `${base}?key=${encodeURIComponent(FILE_SERVER_API_KEY)}`;
  }
  return base;
}

async function fetchFileList() {
  const res = await fetch(`${FILE_SERVER_URL}/api/list`, {
    headers: buildHeaders(),
  });
  if (!res.ok) {
    throw new Error(`File server returned ${res.status}`);
  }
  const data = await res.json();
  return data.files || [];
}

const tmdbSearchCache = new Map();

async function searchTMDB(title, year, type) {
  const cacheKey = `${type}:${title}:${year || ""}`;
  if (tmdbSearchCache.has(cacheKey)) {
    return tmdbSearchCache.get(cacheKey);
  }

  let results = [];
  if (type === "movie") {
    results = await tmdb.searchMovie(title, year);
  } else {
    results = await tmdb.searchTV(title, year);
  }

  if (results.length === 0) {
    tmdbSearchCache.set(cacheKey, null);
    return null;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const result of results) {
    const score = matcher.scoreMatch(result, title, year);
    if (score > bestScore && score >= 70) {
      bestScore = score;
      bestMatch = result;
    }
  }

  tmdbSearchCache.set(cacheKey, bestMatch);
  return bestMatch;
}

module.exports = async function (args) {
  try {
    const files = await fetchFileList();
    const type = args.type || "movie";

    if (type === "series") {
      const seriesFiles = files.filter((f) => f.type === "series" && f.title);
      const shows = new Map();

      for (const file of seriesFiles) {
        if (!shows.has(file.title)) {
          shows.set(file.title, file);
        }
      }

      const metas = await Promise.all(
        Array.from(shows.entries()).map(async ([title, firstEpisode]) => {
          const parsed = matcher.parseFilename(title, "series");
          const tmdbData = await searchTMDB(parsed.title, parsed.year, "series");

          const meta = {
            id: `__series__${title}`,
            type: "series",
            name: title,
            poster: buildThumbUrl(firstEpisode.flatPath),
            background: buildThumbUrl(firstEpisode.flatPath),
            description: `${files.filter((f) => f.title === title).length} episodes`,
          };

          if (tmdbData) {
            meta.poster = tmdb.getImageUrl(tmdbData.poster_path) || meta.poster;
            meta.background = tmdb.getImageUrl(tmdbData.backdrop_path, "original") || meta.background;
            meta.description = tmdbData.overview || meta.description;
            if (tmdbData.first_air_date) {
              meta.releaseInfo = tmdbData.first_air_date.slice(0, 4);
            }
          }

          return meta;
        })
      );

      return { metas };
    }

    const movies = files.filter((f) => f.type === "movie");
    const metas = await Promise.all(
      movies.map(async (file) => {
        const parsed = matcher.parseFilename(file.name, "movie");
        const tmdbData = await searchTMDB(parsed.title, parsed.year, "movie");

        const meta = {
          id: file.flatPath,
          type: "movie",
          name: file.name,
          poster: buildThumbUrl(file.flatPath),
          background: buildThumbUrl(file.flatPath),
          description: [
            file.folderName,
            `${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
            file.isComplete ? "Complete" : "Downloading...",
          ]
            .filter(Boolean)
            .join(" | "),
        };

        if (tmdbData) {
          meta.poster = tmdb.getImageUrl(tmdbData.poster_path) || meta.poster;
          meta.background = tmdb.getImageUrl(tmdbData.backdrop_path, "original") || meta.background;
          meta.description = tmdbData.overview || meta.description;
          if (tmdbData.release_date) {
            meta.releaseInfo = tmdbData.release_date.slice(0, 4);
          }
        }

        return meta;
      })
    );

    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
};
