const http = require("http");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./lib/manifest");
const catalogHandler = require("./lib/catalog");
const metaHandler = require("./lib/meta");
const streamHandler = require("./lib/stream");
const tmdb = require("./lib/tmdb");

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(catalogHandler);
builder.defineMetaHandler(metaHandler);
builder.defineStreamHandler(streamHandler);

const PORT = Number(process.env.PORT || 7001);
// Opt-in addon auth (separate from FILE_SERVER_API_KEY, which must stay in
// stream/poster URLs because Stremio clients can't set headers). When set,
// catalog/meta/stream require the key via X-API-Key, Bearer, or ?key= —
// mirroring file-server/server.py. Manifest + landing stay public so Stremio
// can install. Unset = LAN-open (previous behaviour, QA default).
const ADDON_API_KEY = process.env.ADDON_API_KEY || "";

// Simple in-memory rate limit: 300 req / 60s per IP. No new deps.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 300;
const rateHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 1000) {
    const oldest = [...rateHits.keys()][0];
    rateHits.delete(oldest);
  }
  return hits.length > RATE_MAX;
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function addonKeyValid(req) {
  if (!ADDON_API_KEY) return true;
  const url = new URL(req.url, "http://localhost");
  if (req.headers["x-api-key"] === ADDON_API_KEY) return true;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === ADDON_API_KEY) return true;
  if (url.searchParams.get("key") === ADDON_API_KEY) return true;
  return false;
}

const PUBLIC_PATHS = new Set(["/", "/manifest.json"]);
function isPublicPath(req) {
  const path = req.url.split("?")[0];
  return PUBLIC_PATHS.has(path);
}

const router = getRouter(builder.getInterface());

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  const ip = req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ err: "rate limited" }));
    return;
  }
  if (!isPublicPath(req) && !addonKeyValid(req)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ err: "unauthorized" }));
    return;
  }
  if (req.url === "/" || req.url.startsWith("/?")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<html><body><h1>Local File Server</h1><p><a href="/manifest.json">manifest.json</a></p></body></html>`
    );
    return;
  }
  router(req, res, () => {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ err: "not found" }));
  });
});

server.requestTimeout = 15_000;
server.headersTimeout = 16_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP addon accessible at: http://127.0.0.1:${PORT}/manifest.json`);
  if (tmdb.isEnabled()) {
    console.log("TMDB integration enabled");
  } else {
    console.log("TMDB integration disabled (no API token)");
  }
  if (ADDON_API_KEY) {
    console.log("Addon auth enabled (catalog/meta/stream require API key)");
  } else {
    console.log("Addon auth disabled (ADDON_API_KEY unset — LAN-open)");
  }
});
