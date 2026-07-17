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

    if (args.type === "series" && args.id.startsWith("__series__")) {
      const showTitle = args.id.replace("__series__", "");
      const episodes = files.filter(
        (f) => f.type === "series" && f.title === showTitle
      );

      if (episodes.length === 0) {
        return { meta: null };
      }

      const firstEp = episodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      })[0];

      return {
        meta: {
          id: args.id,
          type: "series",
          name: showTitle,
          poster: buildThumbUrl(firstEp.flatPath),
          background: buildThumbUrl(firstEp.flatPath),
          description: `${episodes.length} episodes`,
          videos: episodes
            .sort((a, b) => {
              if (a.season !== b.season) return a.season - b.season;
              return a.episode - b.episode;
            })
            .map((ep) => ({
              id: ep.flatPath,
              title: `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")} - ${ep.name}`,
              season: ep.season,
              episode: ep.episode,
            })),
        },
      };
    }

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
      },
    };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: null };
  }
};
