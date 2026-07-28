# AGENTS.md

## Architecture

Two services over HTTP:

- **file-server** (`file-server/server.py`) — Python/FastAPI. Serves video with range requests, FFmpeg thumbnails, background scanner (1s interval). Detects movie/series from filename/path. `SOURCE_DIRS` (comma-separated) overrides `SOURCE_DIR`.
- **addon** (`addon/index.js`) — Node.js 18+. Stremio addon SDK. Fetches file list from file server → catalog/meta/stream handlers. Optional TMDB enrichment.

Stremio → addon → file server API → stream directly from file server.

## Run

```bash
cp .env.example .env  # set MEDIA_DIR, API_KEY, TMDB_API_READ_ACCESS_TOKEN
docker-compose up -d
```

## Verify

```bash
# Python syntax
python3 -c "import ast; ast.parse(open('file-server/server.py').read())"

# Node addon loads (no deps needed on host — just syntax check)
cd addon && node -e "require('./lib/manifest'); console.log('OK')"

# Live health
curl http://localhost:3003/health

# Catalog/stream (with API key)
curl -H "X-API-Key: $KEY" http://localhost:7001/catalog/movie/local.json
curl -H "X-API-Key: $KEY" "http://localhost:7001/stream/movie/FILENAME.json"
```

No test framework. No linter config. No typecheck. `node index.js` is the only way to run addon.

## Gotchas

- **Port 7000 blocked on macOS** — AirPlay hijacks 7000. Addon on 7001. Dockerfile's `EXPOSE 7000` is wrong but harmless (orchestration override). Don't change back.
- **`flatPath` vs `path`** — file-server returns both. `flatPath` = bare filename (used as meta/stream ID for Stremio). `path` = relative path with dirs (used as stream URL). Stream handler matches on `flatPath`, builds URL from `path`.
- **Two FILE_SERVER_URL vars** — `FILE_SERVER_URL` = Docker internal (`http://file-server:3003`). `FILE_SERVER_PUBLIC_URL` = client-facing (`http://localhost:3003`). Poster/stream URLs use PUBLIC. API calls use internal.
- **Stream handler caches file list 5s** — `stream.js` has its own `CACHE_TTL=5000` cache. Not redundant with file server scan — avoids /api/list on every stream request.
- **Series IDs use `__series__` prefix** — `__series__{title}`. Stream/meta match episodes by `flatPath`, not show ID.
- **Subtitle matching by stem prefix** — `Movie.mp4` matches `Movie.eng.srt`, `Movie.spa.srt`, `Movie.forced.eng.srt`. Subtitle stem must start with video stem (case-insensitive).
- **File dedup by full path** — Dedup key is `{root}:{relpath}`, not basename. Prevents collisions across multi-dir setups.
- **API key auth** — Three methods: `X-API-Key` header, `Authorization: Bearer`, `?key=` query param. All checked in order.
- **Stream endpoint supports HEAD** — Required for ffprobe/hls-probe. Returns 200 with Content-Type/Content-Length, no body. Don't remove HEAD.
- **Content-Type must match extension** — `application/octet-stream` breaks browser/player. Use correct MIME from `VIDEO_EXTENSIONS`/`SUBTITLE_EXTENSIONS`.
- **ffmpeg must be apt-installed in runtime stage** — `COPY --from=builder /usr/bin/ffmpeg` breaks (missing shared libs). Install via `apt-get` in final stage.
- **Health check uses Python urllib** — Slim images lack wget/curl. Don't change healthcheck to use them.
- **Media volume is `:ro`** — Read-only mount. No DELETE endpoint.
- **SOURCE_DIRS needs matching volumes** — Each dir in `SOURCE_DIRS` must have a corresponding `volumes:` entry in docker-compose.yml.
- **CI: native arm64 runners** — QEMU too slow. Workflow uses `ubuntu-24.04-arm` for arm64, `ubuntu-latest` for amd64. Each arch builds + pushes by digest separately, then merge job creates multi-arch manifest.
- **TMDB is optional** — No token = current behavior (file thumbnails). Token set = enriches posters/descriptions/ratings. Falls back gracefully on search miss or API error. Rate-limited to 40 req/10s, 24h cache.

## Content Detection

File server classifies each video:

- `S01E01`, `01x01` in filename → series
- 3+ path levels + season folder (`Season N`, `S01`, `Temporada N`, `Saison N`, `Staffel N`, `Stagione N`) → series
- Everything else → movie

`/api/list` response includes: `type`, `title`, `season`, `episode`, `subtitles[]`, `sourceDir`, `flatPath`, `path`.

## Structure

```
file-server/
  server.py          # FastAPI app (scanner, streaming, thumbnails, subtitle detection)
  requirements.txt   # fastapi, uvicorn, aiofiles, python-multipart
  Dockerfile         # multi-stage python:3.11-slim + ffmpeg

addon/
  index.js           # entry, wires handlers
  lib/manifest.js    # Stremio manifest
  lib/catalog.js     # catalog handler — splits movie/series, TMDB enrichment
  lib/meta.js        # meta handler — series episodes array, movie single meta, TMDB enrichment
  lib/stream.js      # stream handler — returns file server URL + subtitles
  lib/tmdb.js        # TMDB client (cache, rate limit, image URL builder)
  lib/matcher.js     # filename parser (strip quality/codec → title+year)
  package.json       # stremio-addon-sdk only
  Dockerfile         # multi-stage node:20-alpine

docker-compose.yml   # both services, read-only media mount
```
