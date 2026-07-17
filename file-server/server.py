#!/usr/bin/env python3
"""
FastAPI file server for streaming local media files with Stremio addon integration.
- Async I/O for concurrent streams
- Range request support for seeking
- Thumbnail extraction via FFmpeg
- Background file scanner
- API key authentication
"""

import os
import sys
import re
import time
import asyncio
import hashlib
import logging
import tempfile
import subprocess
import glob
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Request, Response, Security, Depends
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
import aiofiles
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("file-server")

security = HTTPBearer(auto_error=False)

app = FastAPI(
    title="Local File Server",
    description="HTTP file server for Stremio local media streaming",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_EXTENSIONS = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
    ".3gp": "video/3gpp",
    ".ogv": "video/ogg",
    ".ts": "video/mp2t",
    ".m2ts": "video/mp2t",
}

SUBTITLE_EXTENSIONS = {
    ".srt": "text/plain",
    ".ass": "text/x-ssa",
    ".sub": "text/plain",
    ".ssa": "text/x-ssa",
}

LANG_CODE_MAP = {
    "eng": "English", "en": "English", "english": "English",
    "es": "Spanish", "spa": "Spanish", "esp": "Spanish", "spanish": "Spanish",
    "fr": "French", "fre": "French", "fra": "French", "french": "French",
    "de": "German", "ger": "German", "deu": "German", "german": "German",
    "it": "Italian", "ita": "Italian", "italian": "Italian",
    "pt": "Portuguese", "por": "Portuguese", "portuguese": "Portuguese",
    "ru": "Russian", "rus": "Russian", "russian": "Russian",
    "ja": "Japanese", "jpn": "Japanese", "japanese": "Japanese",
    "ko": "Korean", "kor": "Korean", "korean": "Korean",
    "zh": "Chinese", "chi": "Chinese", "zho": "Chinese", "chinese": "Chinese",
    "ar": "Arabic", "ara": "Arabic", "arabic": "Arabic",
    "hi": "Hindi", "hin": "Hindi", "hindi": "Hindi",
    "nl": "Dutch", "dut": "Dutch", "nld": "Dutch", "dutch": "Dutch",
    "sv": "Swedish", "swe": "Swedish", "swedish": "Swedish",
    "no": "Norwegian", "nor": "Norwegian", "norwegian": "Norwegian",
    "da": "Danish", "dan": "Danish", "danish": "Danish",
    "fi": "Finnish", "fin": "Finnish", "finnish": "Finnish",
    "pl": "Polish", "pol": "Polish", "polish": "Polish",
    "tr": "Turkish", "tur": "Turkish", "turkish": "Turkish",
    "he": "Hebrew", "heb": "Hebrew", "hebrew": "Hebrew",
    "th": "Thai", "tha": "Thai", "thai": "Thai",
}

def detect_subtitle_lang(filename: str) -> str:
    name_no_ext = os.path.splitext(filename)[0].lower()
    parts = re.split(r'[\s._-]+', name_no_ext)
    for part in reversed(parts):
        mapped = LANG_CODE_MAP.get(part)
        if mapped:
            return mapped
    for part in reversed(parts):
        if len(part) >= 2:
            mapped = LANG_CODE_MAP.get(part)
            if mapped:
                return mapped
    clean = re.sub(r'[\s._-]+', ' ', name_no_ext).strip()
    return clean.title() if clean else "Unknown"

THUMBNAIL_CACHE_DIR = os.path.join(tempfile.gettempdir(), "file-server-thumbnails")
THUMBNAIL_WIDTH = 320

SE_PATTERNS = [
    re.compile(r'[Ss](\d{1,2})[Ee](\d{1,2})'),
    re.compile(r'[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,2})', re.I),
    re.compile(r'(\d{1,2})x(\d{1,2})'),
    re.compile(r'[Ee]p?(?:isode)?\s*(\d{1,2})', re.I),
]

SEASON_FOLDER_PATTERNS = [
    re.compile(r'(?:season|temporada|saison|staffel|stagione)\s*(\d{1,2})', re.I),
    re.compile(r'^[Ss](\d{1,2})$'),
    re.compile(r'^(\d{1,2})$'),
]

def detect_content_type(rel: str, name: str) -> Dict[str, Any]:
    name_no_ext = os.path.splitext(name)[0]
    parts = rel.split('/')
    n = len(parts)

    se_match = None
    for pattern in SE_PATTERNS[:-1]:
        m = pattern.search(name_no_ext)
        if m:
            se_match = m
            break

    if se_match:
        season = int(se_match.group(1))
        episode = int(se_match.group(2))

        if n == 1:
            title = "Unknown Series"
        else:
            title = parts[0]

        return {"type": "series", "title": title, "season": season, "episode": episode}

    if n >= 3:
        show = parts[0]
        for part in parts[1:-1]:
            for sf_pattern in SEASON_FOLDER_PATTERNS:
                m = sf_pattern.search(part)
                if m:
                    season = int(m.group(1))

                    ep_match = None
                    for ep_pattern in SE_PATTERNS[:-1]:
                        m2 = ep_pattern.search(name_no_ext)
                        if m2:
                            ep_match = m2
                            break

                    if ep_match:
                        episode = int(ep_match.group(2))
                    else:
                        ep_only = SE_PATTERNS[-1].search(name_no_ext)
                        episode = int(ep_only.group(1)) if ep_only else 1

                    return {"type": "series", "title": show, "season": season, "episode": episode}

    return {"type": "movie", "title": None, "season": None, "episode": None}


class Config:
    @property
    def API_KEY(self) -> Optional[str]:
        return os.environ.get("FILE_SERVER_API_KEY") or os.environ.get("API_KEY")

    @property
    def SOURCE_DIR(self) -> str:
        return os.environ.get("SOURCE_DIR", "/media")

    @property
    def SOURCE_DIRS(self) -> List[str]:
        dirs = os.environ.get("SOURCE_DIRS")
        if dirs:
            return [d.strip() for d in dirs.split(',') if d.strip()]
        return [self.SOURCE_DIR]

    @property
    def PORT(self) -> int:
        return int(os.environ.get("PORT", "3003"))


config = Config()

FILE_INDEX: Dict[str, Any] = {"files": [], "last_scan": 0, "scanning": False}
FILE_INDEX_LOCK = asyncio.Lock()


# === Authentication ===

async def verify_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> bool:
    if not config.API_KEY:
        return True

    if x_api_key == config.API_KEY:
        return True

    if credentials and credentials.credentials == config.API_KEY:
        return True

    if request.query_params.get("key") == config.API_KEY:
        return True

    raise HTTPException(status_code=401, detail="Invalid or missing API key")


# === File Scanner ===

async def scan_files() -> List[Dict[str, Any]]:
    dirs = config.SOURCE_DIRS
    files = []
    seen = set()

    for root in dirs:
        if not os.path.isdir(root):
            logger.warning(f"Source directory not found: {root}")
            continue

        try:
            for dirpath, _, filenames in os.walk(root):
                sub_files_in_dir = []
                for fname in filenames:
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in SUBTITLE_EXTENSIONS:
                        sub_files_in_dir.append(fname)

                for fname in filenames:
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in VIDEO_EXTENSIONS:
                        continue

                    full = os.path.join(dirpath, fname)
                    rel = os.path.relpath(full, root)
                    rel_normalized = rel.replace("\\", "/")

                    try:
                        st = os.stat(full)
                    except OSError:
                        continue

                    dedup_key = f"{root}:{rel_normalized}"
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    is_complete = "incomplete" not in rel.lower()
                    folder = os.path.basename(os.path.dirname(full))
                    content_info = detect_content_type(rel_normalized, fname)

                    video_stem = os.path.splitext(fname)[0].lower()
                    subtitles = []
                    for sub_fname in sub_files_in_dir:
                        sub_stem = os.path.splitext(sub_fname)[0].lower()
                        if sub_stem == video_stem or sub_stem.startswith(video_stem):
                            lang = detect_subtitle_lang(sub_fname)
                            subtitles.append({
                                "name": sub_fname,
                                "path": os.path.join(os.path.dirname(rel_normalized), sub_fname).replace("\\", "/").lstrip("./"),
                                "lang": lang,
                            })

                    files.append({
                        "name": fname,
                        "path": rel_normalized,
                        "flatPath": fname,
                        "folderName": folder,
                        "size": st.st_size,
                        "modified": st.st_mtime,
                        "isComplete": is_complete,
                        "type": content_info["type"],
                        "title": content_info["title"],
                        "season": content_info["season"],
                        "episode": content_info["episode"],
                        "subtitles": subtitles,
                        "sourceDir": root,
                    })

        except Exception as e:
            logger.error(f"Scan error in {root}: {e}")

    files.sort(key=lambda x: (not x["isComplete"], -x["modified"]))
    return files


async def continuous_scanner():
    logger.info("Background scanner started (1s interval)")
    while True:
        try:
            async with FILE_INDEX_LOCK:
                if not FILE_INDEX["scanning"]:
                    FILE_INDEX["scanning"] = True
                    try:
                        files = await scan_files()
                        old = len(FILE_INDEX["files"])
                        FILE_INDEX["files"] = files
                        FILE_INDEX["last_scan"] = time.time()
                        if len(files) != old:
                            logger.info(f"File index: {len(files)} videos")
                    finally:
                        FILE_INDEX["scanning"] = False
        except Exception as e:
            logger.error(f"Scanner error: {e}")
        await asyncio.sleep(1)


# === Thumbnail ===

def find_file_by_name(filename: str) -> Optional[str]:
    for root in config.SOURCE_DIRS:
        for dirpath, _, filenames in os.walk(root):
            if filename in filenames:
                return os.path.join(dirpath, filename)
    return None


def extract_thumbnail(file_path: str, dest: str) -> bool:
    cmd = [
        "ffmpeg", "-y", "-i", file_path,
        "-vframes", "1",
        "-vf", f"scale={THUMBNAIL_WIDTH}:-1",
        "-f", "image2",
        dest,
    ]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30
        )
        return result.returncode == 0
    except Exception:
        return False


def get_thumbnail_path(filename: str) -> Optional[str]:
    os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)
    h = hashlib.md5(filename.encode()).hexdigest()[:12]
    thumb = os.path.join(THUMBNAIL_CACHE_DIR, f"{h}.png")

    if os.path.exists(thumb) and os.path.getsize(thumb) > 0:
        return thumb

    source = find_file_by_name(filename)
    if not source:
        return None

    if extract_thumbnail(source, thumb):
        return thumb
    return None


# === Streaming ===

async def stream_file_range(
    file_path: str, start: int, end: int, chunk_size: int = 256 * 1024
):
    content_length = end - start + 1
    sent = 0

    async with aiofiles.open(file_path, "rb") as f:
        await f.seek(start)
        remaining = content_length

        while remaining > 0:
            to_read = min(chunk_size, remaining)
            chunk = await f.read(to_read)
            if not chunk:
                break
            yield chunk
            sent += len(chunk)
            remaining -= len(chunk)


# === Endpoints ===

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": config.SOURCE_DIRS,
    }


@app.get("/api/list")
async def list_files(auth: bool = Depends(verify_api_key)):
    async with FILE_INDEX_LOCK:
        files = FILE_INDEX["files"].copy()
        age = time.time() - FILE_INDEX["last_scan"]

    complete = sum(1 for f in files if f["isComplete"])
    logger.info(f"/api/list: {len(files)} files ({complete} complete, cache {age:.1f}s)")
    return JSONResponse(content={"files": files})


@app.get("/api/thumbnail/{filename}")
async def thumbnail(filename: str, auth: bool = Depends(verify_api_key)):
    path = get_thumbnail_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.api_route("/{file_path:path}", methods=["GET", "HEAD"])
async def stream(
    file_path: str,
    request: Request,
    range: Optional[str] = Header(None),
    auth: bool = Depends(verify_api_key),
):
    full = None
    for root in config.SOURCE_DIRS:
        candidate = os.path.join(root, file_path)
        if os.path.exists(candidate) and not os.path.isdir(candidate):
            full = candidate
            break

    if not full:
        filename = os.path.basename(file_path)
        found = find_file_by_name(filename)
        if found:
            full = found
        else:
            raise HTTPException(status_code=404, detail="File not found")

    if os.path.isdir(full):
        raise HTTPException(status_code=400, detail="Cannot stream directory")

    file_size = os.path.getsize(full)
    ext = os.path.splitext(full)[1].lower()
    content_type = VIDEO_EXTENSIONS.get(ext) or SUBTITLE_EXTENSIONS.get(ext, "application/octet-stream")

    if request.method == "HEAD":
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": content_type,
        }
        return Response(status_code=200, headers=headers, media_type=content_type)

    start = 0
    end = file_size - 1

    if range:
        match = re.search(r"bytes=(\d+)-(\d*)", range)
        if match:
            start = int(match.group(1))
            if match.group(2):
                end = int(match.group(2))

    if start >= file_size:
        raise HTTPException(status_code=416, detail="Range Not Satisfiable")

    if end >= file_size:
        end = file_size - 1

    content_length = end - start + 1
    logger.info(f"Stream: {os.path.basename(full)} {start}-{end}/{file_size}")

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": content_type,
    }

    return StreamingResponse(
        stream_file_range(full, start, end),
        status_code=206,
        headers=headers,
        media_type=content_type,
    )


@app.on_event("startup")
async def startup():
    os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)
    logger.info(f"Source: {config.SOURCE_DIRS}")
    logger.info(f"Auth: {'enabled' if config.API_KEY else 'disabled'}")

    files = await scan_files()
    async with FILE_INDEX_LOCK:
        FILE_INDEX["files"] = files
        FILE_INDEX["last_scan"] = time.time()

    logger.info(f"Initial scan: {len(files)} videos")
    asyncio.create_task(continuous_scanner())


@app.on_event("shutdown")
async def shutdown():
    logger.info("Shutting down")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Local file server for Stremio")
    parser.add_argument("directory", nargs="?", default=None, help="Directory to serve")
    parser.add_argument("--port", "-p", type=int, default=3003)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--log-level", default="info", choices=["debug", "info", "warning", "error"])

    args = parser.parse_args()

    if args.directory:
        os.environ["SOURCE_DIR"] = os.path.abspath(args.directory)
    if args.api_key:
        os.environ["API_KEY"] = args.api_key

    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        workers=args.workers,
        log_level=args.log_level,
        access_log=True,
    )


if __name__ == "__main__":
    main()
