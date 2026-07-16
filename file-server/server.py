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

THUMBNAIL_CACHE_DIR = os.path.join(tempfile.gettempdir(), "file-server-thumbnails")
THUMBNAIL_WIDTH = 320


class Config:
    @property
    def API_KEY(self) -> Optional[str]:
        return os.environ.get("FILE_SERVER_API_KEY") or os.environ.get("API_KEY")

    @property
    def SOURCE_DIR(self) -> str:
        return os.environ.get("SOURCE_DIR", "/media")

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
    root = config.SOURCE_DIR
    if not os.path.isdir(root):
        logger.warning(f"Source directory not found: {root}")
        return []

    files = []
    seen = set()

    try:
        for dirpath, _, filenames in os.walk(root):
            for fname in filenames:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in VIDEO_EXTENSIONS:
                    continue

                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, root)

                try:
                    st = os.stat(full)
                except OSError:
                    continue

                if fname in seen:
                    continue
                seen.add(fname)

                is_complete = "incomplete" not in rel.lower()
                folder = os.path.basename(os.path.dirname(full))

                files.append({
                    "name": fname,
                    "path": rel.replace("\\", "/"),
                    "flatPath": fname,
                    "folderName": folder,
                    "size": st.st_size,
                    "modified": st.st_mtime,
                    "isComplete": is_complete,
                })

    except Exception as e:
        logger.error(f"Scan error: {e}")

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
    root = config.SOURCE_DIR
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
        "source": config.SOURCE_DIR,
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
    root = config.SOURCE_DIR
    full = os.path.join(root, file_path)

    if not os.path.exists(full):
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
    content_type = VIDEO_EXTENSIONS.get(ext, "application/octet-stream")

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
    logger.info(f"Source: {config.SOURCE_DIR}")
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
