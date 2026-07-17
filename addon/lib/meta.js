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

    if (args.type === "series" && args.id.startsWith("__series__")) {
      const showTitle = args.id.replace("__series__", "");
      const episodes = files.filter(
        (f) => f.type === "series" && f.title === showTitle
      );

      if (episodes.length === 0) {
        return { meta: null };
      }

      const firstEp = episodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      })[0];

      const parsed = matcher.parseFilename(showTitle, "series");
      const tmdbShow = await searchTMDB(parsed.title, parsed.year, "series");

      const meta = {
        id: args.id,
        type: "series",
        name: showTitle,
        poster: buildThumbUrl(firstEp.flatPath),
        background: buildThumbUrl(firstEp.flatPath),
        description: `${episodes.length} episodes`,
        videos: episodes
          .sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            return a.episode - b.episode;
          })
          .map((ep) => ({
            id: ep.flatPath,
            title: `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")} - ${ep.name}`,
            season: ep.season,
            episode: ep.episode,
          })),
      };

      if (tmdbShow) {
        meta.poster = tmdb.getImageUrl(tmdbShow.poster_path) || meta.poster;
        meta.background = tmdb.getImageUrl(tmdbShow.backdrop_path, "original") || meta.background;
        meta.description = tmdbShow.overview || meta.description;
        if (tmdbShow.first_air_date) {
          meta.releaseInfo = tmdbShow.first_air_date.slice(0, 4);
        }

        const episodesWithTMDB = await Promise.all(
          meta.videos.map(async (ep) => {
            const epData = await tmdb.getTVEpisode(tmdbShow.id, ep.season, ep.episode);
            if (epData) {
              return {
                ...ep,
                title: epData.name || ep.title,
                description: epData.overview,
                thumbnail: tmdb.getImageUrl(epData.still_path),
              };
            }
            return ep;
          })
        );
        meta.videos = episodesWithTMDB;
      }

      return { meta };
    }

    const match = files.find((f) => f.flatPath === args.id);

    if (!match) {
      return { meta: null };
    }

    const parsed = matcher.parseFilename(match.name, "movie");
    const tmdbMovie = await searchTMDB(parsed.title, parsed.year, "movie");

    const meta = {
      id: match.flatPath,
      type: "movie",
      name: match.name,
      poster: buildThumbUrl(match.flatPath),
      background: buildThumbUrl(match.flatPath),
      description: [
        match.folderName,
        `${(match.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
        match.isComplete ? "Complete" : "Downloading...",
      ]
        .filter(Boolean)
        .join(" | "),
    };

    if (tmdbMovie) {
      meta.poster = tmdb.getImageUrl(tmdbMovie.poster_path) || meta.poster;
      meta.background = tmdb.getImageUrl(tmdbMovie.backdrop_path, "original") || meta.background;
      meta.description = tmdbMovie.overview || meta.description;
      if (tmdbMovie.release_date) {
        meta.releaseInfo = tmdbMovie.release_date.slice(0, 4);
      }
    }

    return { meta };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: null };
  }
};
