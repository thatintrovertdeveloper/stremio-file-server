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
    const match = files.find((f) => f.flatPath === args.id);

    if (!match) {
      return { meta: null };
    }

    return {
      meta: {
        id: match.flatPath,
        type: "movie",
        name: match.name,
        poster: buildThumbUrl(match.flatPath),
        background: buildThumbUrl(match.flatPath),
        description: [
          match.folderName,
          `${(match.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
          match.isComplete ? "Complete" : "Downloading...",
        ]
          .filter(Boolean)
          .join(" | "),
        videos: [
          {
            id: match.flatPath,
            title: match.name,
            season: 1,
            episode: 1,
          },
        ],
      },
    };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: null };
  }
};
