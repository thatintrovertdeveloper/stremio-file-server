const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./lib/manifest");
const catalogHandler = require("./lib/catalog");
const metaHandler = require("./lib/meta");
const streamHandler = require("./lib/stream");

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(catalogHandler);
builder.defineMetaHandler(metaHandler);
builder.defineStreamHandler(streamHandler);

const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), {
  port: Number(PORT),
  host: "0.0.0.0",
});
