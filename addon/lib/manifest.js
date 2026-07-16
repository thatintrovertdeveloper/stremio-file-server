const manifest = {
  id: "org.stremio.localfileserver",
  version: "1.0.0",
  name: "Local File Server",
  description: "Stream local media files via HTTP file server",
  catalogs: [
    {
      id: "local",
      name: "Local Files",
      type: "movie",
    },
  ],
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: [""],
};

module.exports = manifest;
