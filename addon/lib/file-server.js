const tmdb = require("./tmdb");
const matcher = require("./matcher");

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

// Upstream timeout + bounded cache: fail closed instead of hanging handlers
// (A06/A10), and cap memory when distinct titles are requested (A06 DoS).
const FETCH_TIMEOUT_MS = parseInt(process.env.FILE_SERVER_TIMEOUT_MS || "8000", 10);
const TMDB_SEARCH_CACHE_MAX = 500;
const tmdbSearchCache = new Map();

function cacheSetBounded(map, key, value, max) {
  if (map.size >= max && !map.has(key)) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, value);
}

function buildHeaders() {
  const headers = {};
  if (FILE_SERVER_API_KEY) {
    headers["X-API-Key"] = FILE_SERVER_API_KEY;
  }
  return headers;
}

function buildThumbUrl(filename, shape = "landscape") {
  const base = `${FILE_SERVER_PUBLIC_URL}/api/thumbnail/${encodeURIComponent(filename)}`;
  const params = new URLSearchParams();
  if (shape !== "landscape") {
    params.set("shape", shape);
  }
  if (FILE_SERVER_API_KEY) {
    params.set("key", FILE_SERVER_API_KEY);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function fetchFileList() {
  const res = await fetch(`${FILE_SERVER_URL}/api/list`, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    cacheSetBounded(tmdbSearchCache, cacheKey, null, TMDB_SEARCH_CACHE_MAX);
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

  cacheSetBounded(tmdbSearchCache, cacheKey, bestMatch, TMDB_SEARCH_CACHE_MAX);
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
