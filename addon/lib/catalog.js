const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

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

module.exports = async function (args) {
  try {
    const files = await fetchFileList();
    const type = args.type || "movie";

    if (type === "series") {
      const seriesFiles = files.filter((f) => f.type === "series" && f.title);
      const shows = new Map();

      for (const file of seriesFiles) {
        if (!shows.has(file.title)) {
          shows.set(file.title, file);
        }
      }

      const metas = Array.from(shows.entries()).map(([title, firstEpisode]) => ({
        id: `__series__${title}`,
        type: "series",
        name: title,
        poster: buildThumbUrl(firstEpisode.flatPath),
        background: buildThumbUrl(firstEpisode.flatPath),
        description: `${files.filter((f) => f.title === title).length} episodes`,
      }));

      return { metas };
    }

    const metas = files
      .filter((f) => f.type === "movie")
      .map((file) => ({
        id: file.flatPath,
        type: "movie",
        name: file.name,
        poster: buildThumbUrl(file.flatPath),
        background: buildThumbUrl(file.flatPath),
        description: [
          file.folderName,
          `${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
          file.isComplete ? "Complete" : "Downloading...",
        ]
          .filter(Boolean)
          .join(" | "),
      }));

    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
};
