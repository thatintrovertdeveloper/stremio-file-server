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
    {
      id: "local",
      name: "Local Series",
      type: "series",
    },
  ],
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: [""],
};

module.exports = manifest;
