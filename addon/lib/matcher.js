const QUALITY_TAGS = [
  "2160p", "4k", "1080p", "720p", "480p", "360p",
  "bluray", "brrip", "bdrip", "webrip", "webdl", "web-dl",
  "hdrip", "dvdrip", "dvdscr", "hdtv", "pdtv", "tvrip",
  "cam", "hdcam", "ts", "hcts", "hdts", "tc", "hdrc",
];

const CODEC_TAGS = [
  "x264", "x265", "xvid", "divx", "h264", "h265", "hevc", "av1",
  "aac", "ac3", "dts", "mp3", "flac", "truehd", "atmos",
];

const GROUP_PATTERN = /-([a-z0-9]+)$/i;
const YEAR_PATTERN = /[\(\[]?((?:19|20)\d{2})[\)\]]?/;
const SEASON_EPISODE_PATTERN = /S(\d{1,2})E(\d{1,3})/i;
const EPISODE_ONLY_PATTERN = /E(\d{1,3})/i;

function cleanTitle(raw) {
  let title = raw
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\bS\d{1,2}E\d{1,3}\b/gi, "")
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, "")
    .replace(new RegExp(`\\b(${QUALITY_TAGS.join("|")})\\b`, "gi"), "")
    .replace(new RegExp(`\\b(${CODEC_TAGS.join("|")})\\b`, "gi"), "")
    .replace(GROUP_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();

  return title;
}

function extractYear(str) {
  const match = str.match(YEAR_PATTERN);
  if (match) {
    return match[1];
  }
  return null;
}

function extractSeasonEpisode(str) {
  const match = str.match(SEASON_EPISODE_PATTERN);
  if (match) {
    return {
      season: parseInt(match[1], 10),
      episode: parseInt(match[2], 10),
    };
  }

  const epOnly = str.match(EPISODE_ONLY_PATTERN);
  if (epOnly) {
    return {
      season: 1,
      episode: parseInt(epOnly[1], 10),
    };
  }

  return null;
}

function parseFilename(filename, type = "movie") {
  const year = extractYear(filename);
  const title = cleanTitle(filename);
  const episodeInfo = type === "series" ? extractSeasonEpisode(filename) : null;

  return {
    title,
    year,
    season: episodeInfo?.season,
    episode: episodeInfo?.episode,
  };
}

function scoreMatch(result, queryTitle, queryYear) {
  let score = 0;
  const resultTitle = (result.title || result.name || "").toLowerCase();
  const query = queryTitle.toLowerCase();

  if (resultTitle === query) {
    score += 100;
  } else if (resultTitle.includes(query) || query.includes(resultTitle)) {
    score += 60;
  } else {
    const words1 = new Set(query.split(/\s+/));
    const words2 = new Set(resultTitle.split(/\s+/));
    const intersection = [...words1].filter((w) => words2.has(w));
    score += (intersection.length / Math.max(words1.size, words2.size)) * 60;
  }

  const resultYear = (result.release_date || result.first_air_date || "").slice(0, 4);
  if (queryYear && resultYear === queryYear) {
    score += 40;
  }

  return score;
}

module.exports = {
  parseFilename,
  scoreMatch,
  cleanTitle,
  extractYear,
};
