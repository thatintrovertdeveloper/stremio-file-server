import os
import hashlib
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

SUBTITLE_CACHE_DIR = "/tmp/file-server-subtitles"

SUBTITLE_EXT_MAP = {".srt", ".ass", ".ssa", ".sub"}
DEFAULT_EXT = ".srt"


@dataclass
class SubtitleResult:
    name: str
    path: str
    lang: str
    provider: str


LANG_TO_2LETTER = {
    "eng": "en", "en": "en", "english": "en",
    "spa": "es", "es": "es", "spanish": "es",
    "fra": "fr", "fr": "fr", "fre": "fr", "french": "fr",
    "deu": "de", "de": "de", "ger": "de", "german": "de",
    "ita": "it", "it": "it", "italian": "it",
    "por": "pt", "pt": "pt", "portuguese": "pt",
    "rus": "ru", "ru": "ru", "russian": "ru",
    "jpn": "ja", "ja": "ja", "japanese": "ja",
    "kor": "ko", "ko": "ko", "korean": "ko",
    "zho": "zh", "zh": "zh", "chi": "zh", "chinese": "zh",
    "ara": "ar", "ar": "ar", "arabic": "ar",
    "hin": "hi", "hi": "hi", "hindi": "hi",
    "nld": "nl", "nl": "nl", "dutch": "nl", "dut": "nl",
    "swe": "sv", "sv": "sv", "swedish": "sv",
    "nor": "no", "no": "no", "norwegian": "no",
    "dan": "da", "da": "da", "danish": "da",
    "fin": "fi", "fi": "fi", "finnish": "fi",
    "pol": "pl", "pl": "pl", "polish": "pl",
    "tur": "tr", "tr": "tr", "turkish": "tr",
    "heb": "he", "he": "he", "hebrew": "he",
    "tha": "th", "th": "th", "thai": "th",
    "vie": "vi", "vi": "vi", "vietnamese": "vi",
}


def to_2letter(code: str) -> str:
    return LANG_TO_2LETTER.get(code.lower().strip(), code[:2])


LANG_NAME_MAP = {
    "en": "English", "eng": "English", "english": "English",
    "es": "Spanish", "spa": "Spanish", "spanish": "Spanish",
    "fr": "French", "fra": "French", "fre": "French", "french": "French",
    "de": "German", "deu": "German", "ger": "German", "german": "German",
    "it": "Italian", "ita": "Italian", "italian": "Italian",
    "pt": "Portuguese", "por": "Portuguese", "portuguese": "Portuguese",
    "ru": "Russian", "rus": "Russian", "russian": "Russian",
    "ja": "Japanese", "jpn": "Japanese", "japanese": "Japanese",
    "ko": "Korean", "kor": "Korean", "korean": "Korean",
    "zh": "Chinese", "zho": "Chinese", "chi": "Chinese", "chinese": "Chinese",
    "ar": "Arabic", "ara": "Arabic", "arabic": "Arabic",
    "hi": "Hindi", "hin": "Hindi", "hindi": "Hindi",
    "nl": "Dutch", "nld": "Dutch", "dut": "Dutch", "dutch": "Dutch",
    "sv": "Swedish", "swe": "Swedish", "swedish": "Swedish",
    "no": "Norwegian", "nor": "Norwegian", "norwegian": "Norwegian",
    "da": "Danish", "dan": "Danish", "danish": "Danish",
    "fi": "Finnish", "fin": "Finnish", "finnish": "Finnish",
    "pl": "Polish", "pol": "Polish", "polish": "Polish",
    "tr": "Turkish", "tur": "Turkish", "turkish": "Turkish",
    "he": "Hebrew", "heb": "Hebrew", "hebrew": "Hebrew",
    "th": "Thai", "tha": "Thai", "thai": "Thai",
    "vi": "Vietnamese", "vie": "Vietnamese", "vietnamese": "Vietnamese",
}


def _normalize_lang(lang: str) -> str:
    return LANG_NAME_MAP.get(lang.lower().strip(), lang.title())


def _detect_ext(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return ext if ext in SUBTITLE_EXT_MAP else DEFAULT_EXT


def _file_hash(title: str, year: Optional[str], season: Optional[int],
               episode: Optional[int], lang: str, provider: str) -> str:
    raw = f"{title}|{year}|{season}|{episode}|{lang}|{provider}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def _save_subtitle(content: bytes, file_hash: str, ext: str) -> str:
    os.makedirs(SUBTITLE_CACHE_DIR, exist_ok=True)
    path = os.path.join(SUBTITLE_CACHE_DIR, f"{file_hash}{ext}")
    with open(path, "wb") as f:
        f.write(content)
    return path


class SubtitleProvider(ABC):
    @abstractmethod
    async def search(
        self, title: str, year: Optional[str],
        season: Optional[int], episode: Optional[int],
        lang: str
    ) -> List[SubtitleResult]:
        ...


class SubDLProvider(SubtitleProvider):
    BASE = "https://api.subdl.com/api/v1/subtitles"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key

    async def search(
        self, title: str, year: Optional[str],
        season: Optional[int], episode: Optional[int],
        lang: str
    ) -> List[SubtitleResult]:
        params = {
            "film_name": title,
            "languages": to_2letter(lang),
            "type": "tv" if season is not None else "movie",
        }
        if year:
            params["year"] = year
        if season is not None:
            params["season_number"] = season
        if episode is not None:
            params["episode_number"] = episode

        headers = {
            "User-Agent": "stremio-addon v1.0.0",
        }
        if self.api_key:
            headers["X-API-Key"] = self.api_key

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(self.BASE, params=params, headers=headers)
                if resp.status_code != 200:
                    logger.warning(f"SubDL search error: {resp.status_code}")
                    return []
                data = resp.json()
                if not data.get("status"):
                    return []
        except Exception as e:
            logger.error(f"SubDL request failed: {e}")
            return []

        results = []
        for sub in data.get("subtitles", []):
            sub_url = sub.get("url", "")
            sub_name = sub.get("name", f"subtitle{_detect_ext(sub.get('url', ''))}")
            sub_lang_raw = sub.get("lang", lang)
            sub_lang = _normalize_lang(sub_lang_raw)
            ext = _detect_ext(sub_name)

            h = _file_hash(title, year, season, episode, sub_lang, "subdl")
            sub_path = f"subtitle/file/{h}{ext}"

            disk_path = os.path.join(SUBTITLE_CACHE_DIR, f"{h}{ext}")
            if os.path.exists(disk_path) and os.path.getsize(disk_path) > 0:
                results.append(SubtitleResult(
                    name=sub_name, path=sub_path,
                    lang=sub_lang, provider="subdl"
                ))
                continue

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    dl_resp = await client.get(sub_url, follow_redirects=True)
                    if dl_resp.status_code == 200:
                        _save_subtitle(dl_resp.content, h, ext)
                        results.append(SubtitleResult(
                            name=sub_name, path=sub_path,
                            lang=sub_lang, provider="subdl"
                        ))
            except Exception as e:
                logger.warning(f"SubDL download failed for {sub_name}: {e}")

        return results


class OpenSubtitlesComProvider(SubtitleProvider):
    BASE = "https://api.opensubtitles.com/api/v1"

    def __init__(self, api_key: str, username: Optional[str] = None,
                 password: Optional[str] = None):
        self.api_key = api_key
        self.username = username
        self.password = password
        self._token: Optional[str] = None

    async def _login(self) -> Optional[str]:
        if self._token:
            return self._token
        if not self.username or not self.password:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.BASE}/login",
                    headers={
                        "Api-Key": self.api_key,
                        "Content-Type": "application/json",
                        "User-Agent": "stremio-addon v1.0.0",
                    },
                    json={
                        "username": self.username,
                        "password": self.password,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    self._token = data.get("token")
                    return self._token
                else:
                    logger.warning(f"OS login failed: {resp.status_code}")
                    return None
        except Exception as e:
            logger.error(f"OS login error: {e}")
            return None

    async def search(
        self, title: str, year: Optional[str],
        season: Optional[int], episode: Optional[int],
        lang: str
    ) -> List[SubtitleResult]:
        params = {
            "query": title,
            "languages": to_2letter(lang),
            "type": "episode" if season is not None else "movie",
            "order_by": "downloads",
            "order_direction": "desc",
        }
        if year:
            params["year"] = year
        if season is not None:
            params["season_number"] = season
        if episode is not None:
            params["episode_number"] = episode

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.BASE}/subtitles",
                    params=params,
                    headers={
                        "Api-Key": self.api_key,
                        "User-Agent": "stremio-addon v1.0.0",
                    },
                    follow_redirects=True,
                )
                if resp.status_code != 200:
                    logger.warning(f"OS search error: {resp.status_code}")
                    return []
                data = resp.json()
        except Exception as e:
            logger.error(f"OS search request failed: {e}")
            return []

        results = []
        for item in data.get("data", []):
            attributes = item.get("attributes", {})
            files = attributes.get("files", [])
            if not files:
                continue
            file_info = files[0]
            file_id = file_info.get("file_id")
            if not file_id:
                continue

            sub_name = file_info.get("file_name", f"subtitle.srt")
            sub_lang_raw = attributes.get("language", lang)
            sub_lang = _normalize_lang(sub_lang_raw)
            ext = _detect_ext(sub_name)

            h = _file_hash(title, year, season, episode, sub_lang, "opensubtitles")
            sub_path = f"subtitle/file/{h}{ext}"

            disk_path = os.path.join(SUBTITLE_CACHE_DIR, f"{h}{ext}")
            if os.path.exists(disk_path) and os.path.getsize(disk_path) > 0:
                results.append(SubtitleResult(
                    name=sub_name, path=sub_path,
                    lang=sub_lang, provider="opensubtitles"
                ))
                continue

            content = await self._download(file_id)
            if content:
                _save_subtitle(content, h, ext)
                results.append(SubtitleResult(
                    name=sub_name, path=sub_path,
                    lang=sub_lang, provider="opensubtitles"
                ))

        return results

    async def _download(self, file_id: int) -> Optional[bytes]:
        token = await self._login()
        headers = {
            "Api-Key": self.api_key,
            "User-Agent": "stremio-addon v1.0.0",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                dl_resp = await client.post(
                    f"{self.BASE}/download",
                    headers=headers,
                    json={"file_id": file_id},
                )
                if dl_resp.status_code != 200:
                    logger.warning(f"OS download link error: {dl_resp.status_code}")
                    return None
                dl_data = dl_resp.json()
                link = dl_data.get("link")
                if not link:
                    return None
                content_resp = await client.get(link, follow_redirects=True)
                if content_resp.status_code == 200:
                    return content_resp.content
        except Exception as e:
            logger.warning(f"OS download failed: {e}")
        return None
