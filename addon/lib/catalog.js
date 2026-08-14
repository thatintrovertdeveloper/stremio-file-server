const { fetchFileList, searchTMDB, buildThumbUrl } = require("./file-server");
const tmdb = require("./tmdb");

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

      const metas = await Promise.all(
        Array.from(shows.entries()).map(async ([title, firstEpisode]) => {
          const parsed = require("./matcher").parseFilename(title, "series");
          const tmdbData = await searchTMDB(parsed.title, parsed.year, "series");

          const meta = {
            id: `__series__${title}`,
            type: "series",
            name: title,
            poster: buildThumbUrl(firstEpisode.flatPath),
            background: buildThumbUrl(firstEpisode.flatPath),
            description: `${files.filter((f) => f.title === title).length} episodes`,
          };

          if (tmdbData) {
            meta.poster = tmdb.getImageUrl(tmdbData.poster_path) || meta.poster;
            meta.background = tmdb.getImageUrl(tmdbData.backdrop_path, "original") || meta.background;
            meta.description = tmdbData.overview || meta.description;
            if (tmdbData.first_air_date) {
              meta.releaseInfo = tmdbData.first_air_date.slice(0, 4);
            }
          }

          return meta;
        })
      );

      return { metas };
    }

    const movies = files.filter((f) => f.type === "movie");
    const metas = await Promise.all(
      movies.map(async (file) => {
        const parsed = require("./matcher").parseFilename(file.name, "movie");
        const tmdbData = await searchTMDB(parsed.title, parsed.year, "movie");

        const meta = {
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
        };

        if (tmdbData) {
          meta.poster = tmdb.getImageUrl(tmdbData.poster_path) || meta.poster;
          meta.background = tmdb.getImageUrl(tmdbData.backdrop_path, "original") || meta.background;
          meta.description = tmdbData.overview || meta.description;
          if (tmdbData.release_date) {
            meta.releaseInfo = tmdbData.release_date.slice(0, 4);
          }
        }

        return meta;
      })
    );

    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
};
