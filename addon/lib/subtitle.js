const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:3003";
const FILE_SERVER_PUBLIC_URL = process.env.FILE_SERVER_PUBLIC_URL || FILE_SERVER_URL;
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "";
const SUBTITLE_LANG = process.env.SUBTITLE_LANG || "eng";

async function fetchExternalSubtitles(title, year, season, episode) {
  const params = new URLSearchParams({ title, lang: SUBTITLE_LANG });
  if (year) params.set("year", year);
  if (season != null) params.set("season", String(season));
  if (episode != null) params.set("episode", String(episode));

  const url = `${FILE_SERVER_URL}/api/subtitle/search?${params.toString()}`;
  const headers = {};
  if (FILE_SERVER_API_KEY) {
    headers["X-API-Key"] = FILE_SERVER_API_KEY;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`Subtitle search error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.subtitles || []).map((sub) => ({
      url: `${FILE_SERVER_PUBLIC_URL}${sub.url}${FILE_SERVER_API_KEY ? `?key=${encodeURIComponent(FILE_SERVER_API_KEY)}` : ""}`,
      lang: SUBTITLE_LANG,
      name: sub.lang,
    }));
  } catch (err) {
    console.error("External subtitle fetch failed:", err.message);
    return [];
  }
}

module.exports = { fetchExternalSubtitles };
