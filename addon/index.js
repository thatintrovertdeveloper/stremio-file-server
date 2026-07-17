const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./lib/manifest");
const catalogHandler = require("./lib/catalog");
const metaHandler = require("./lib/meta");
const streamHandler = require("./lib/stream");
const tmdb = require("./lib/tmdb");

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(catalogHandler);
builder.defineMetaHandler(metaHandler);
builder.defineStreamHandler(streamHandler);

const PORT = process.env.PORT || 7001;

if (tmdb.isEnabled()) {
  console.log("TMDB integration enabled");
} else {
  console.log("TMDB integration disabled (no API token)");
}

serveHTTP(builder.getInterface(), {
  port: Number(PORT),
  host: "0.0.0.0",
});
