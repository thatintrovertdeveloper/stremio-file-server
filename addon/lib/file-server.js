const tmdb = require("./tmdb");
const matcher = require("./matcher");

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

const tmdbSearchCache = new Map();

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

module.exports = {
  FILE_SERVER_URL,
  FILE_SERVER_PUBLIC_URL,
  FILE_SERVER_API_KEY,
  buildHeaders,
  buildThumbUrl,
  fetchFileList,
  searchTMDB,
};
