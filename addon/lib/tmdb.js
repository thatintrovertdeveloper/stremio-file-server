const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const config = {
  enabled: !!process.env.TMDB_API_READ_ACCESS_TOKEN,
  token: process.env.TMDB_API_READ_ACCESS_TOKEN || "",
  cacheTTL: parseInt(process.env.TMDB_CACHE_TTL || "86400", 10),
  language: process.env.TMDB_LANGUAGE || "en-US",
};

const cache = new Map();
const requestQueue = [];
let requestCount = 0;
let windowStart = Date.now();

const MAX_REQUESTS_PER_WINDOW = 40;
const WINDOW_MS = 10_000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > config.cacheTTL * 1000) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function waitForSlot() {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }

  if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
    const waitTime = WINDOW_MS - (now - windowStart);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    requestCount = 0;
    windowStart = Date.now();
  }

  requestCount++;
}

async function tmdbFetch(endpoint, params = {}) {
  if (!config.enabled) return null;

  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await waitForSlot();

  const url = new URL(`${TMDB_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`TMDB API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error("TMDB fetch error:", err.message);
    return null;
  }
}

async function searchMovie(title, year) {
  const params = { query: title, language: config.language };
  if (year) params.year = year;
  const data = await tmdbFetch("/search/movie", params);
  return data?.results || [];
}

async function searchTV(title, year) {
  const params = { query: title, language: config.language };
  if (year) params.first_air_date_year = year;
  const data = await tmdbFetch("/search/tv", params);
  return data?.results || [];
}

async function getMovie(id) {
  const params = { language: config.language, append_to_response: "credits,videos" };
  return tmdbFetch(`/movie/${id}`, params);
}

async function getTV(id) {
  const params = { language: config.language, append_to_response: "credits,videos" };
  return tmdbFetch(`/tv/${id}`, params);
}

async function getTVSeason(tvId, seasonNumber) {
  const params = { language: config.language };
  return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, params);
}

async function getTVEpisode(tvId, seasonNumber, episodeNumber) {
  const params = { language: config.language };
  return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`, params);
}

function getImageUrl(path, size = "w500") {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

function isEnabled() {
  return config.enabled;
}

module.exports = {
  searchMovie,
  searchTV,
  getMovie,
  getTV,
  getTVSeason,
  getTVEpisode,
  getImageUrl,
  isEnabled,
};
