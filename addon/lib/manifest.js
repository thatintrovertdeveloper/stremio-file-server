const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

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
  resources: ["catalog", "stream"],
  types: ["movie"],
};

module.exports = manifest;
