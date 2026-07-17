const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";

let cachedFiles = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

async function fetchFileList() {
  const now = Date.now();
  if (cachedFiles && now - cacheTime < CACHE_TTL) {
    return cachedFiles;
  }

  const headers = {};
  if (FILE_SERVER_API_KEY) {
    headers["X-API-Key"] = FILE_SERVER_API_KEY;
  }

  const res = await fetch(`${FILE_SERVER_URL}/api/list`, { headers });
  if (!res.ok) {
    throw new Error(`File server returned ${res.status}`);
  }
  const data = await res.json();
  cachedFiles = data.files || [];
  cacheTime = now;
  return cachedFiles;
}

function buildStreamUrl(filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const base = `${FILE_SERVER_PUBLIC_URL}/${encoded}`;
  if (FILE_SERVER_API_KEY) {
    return `${base}?key=${encodeURIComponent(FILE_SERVER_API_KEY)}`;
  }
  return base;
}

module.exports = async function (args) {
  try {
    const files = await fetchFileList();
    const match = files.find((f) => f.flatPath === args.id);

    if (!match) {
      return { streams: [] };
    }

    const stream = {
      url: buildStreamUrl(match.path),
      filename: match.flatPath,
      name: "Direct",
      description: `${(match.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
      subtitles: (match.subtitles || []).map((sub) => ({
        url: buildStreamUrl(sub.path),
        lang: sub.lang,
        name: sub.lang,
      })),
      behaviorHints: {
        notWebReady: true,
        filename: match.flatPath,
      },
    };

    return { streams: [stream] };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
};
