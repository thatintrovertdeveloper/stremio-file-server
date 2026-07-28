import logging
import time
from typing import Dict, List, Optional, Tuple

from subtitle_providers import (
    SubtitleResult,
    SubDLProvider,
    OpenSubtitlesComProvider,
)

logger = logging.getLogger(__name__)

CACHE: Dict[str, Tuple[float, List[SubtitleResult]]] = {}
CACHE_TTL = 86400  # 24h


class SubtitleManager:
    def __init__(self, subdl_api_key: Optional[str] = None,
                 os_api_key: Optional[str] = None,
                 os_username: Optional[str] = None,
                 os_password: Optional[str] = None,
                 cache_ttl: int = CACHE_TTL):
        self.providers = []
        if not os_api_key:
            self.providers.append(SubDLProvider(subdl_api_key))
        else:
            self.providers.append(SubDLProvider(subdl_api_key))
            self.providers.append(OpenSubtitlesComProvider(
                os_api_key, os_username, os_password
            ))
        self.cache_ttl = cache_ttl

    def _cache_key(self, title: str, year: Optional[str],
                   season: Optional[int], episode: Optional[int],
                   lang: str) -> str:
        return f"{title}|{year}|{season}|{episode}|{lang}"

    async def search(self, title: str, year: Optional[str],
                     season: Optional[int], episode: Optional[int],
                     lang: str) -> List[SubtitleResult]:
        key = self._cache_key(title, year, season, episode, lang)
        now = time.time()

        cached = CACHE.get(key)
        if cached and now - cached[0] < self.cache_ttl:
            return cached[1]

        seen = set()
        results = []
        for provider in self.providers:
            try:
                subs = await provider.search(title, year, season, episode, lang)
                for sub in subs:
                    dedup = f"{sub.path}|{sub.lang}"
                    if dedup not in seen:
                        seen.add(dedup)
                        results.append(sub)
            except Exception as e:
                logger.warning(f"Provider {type(provider).__name__} failed: {e}")

        CACHE[key] = (now, results)
        return results
