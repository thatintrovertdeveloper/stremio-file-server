# AGENTS.md

## Architecture

Two independent services communicating over HTTP:

- **file-server** (`file-server/server.py`) — Python/FastAPI. Serves video files with range requests, extracts thumbnails via FFmpeg, background file scanner (1s interval). Supports multi-directory via `SOURCE_DIRS` env var.
- **addon** (`addon/index.js`) — Node.js. Stremio addon SDK. Fetches file list from file server, serves movie + series catalog, meta, and stream handlers to Stremio.

Stremio connects to addon → addon calls file server API → Stremio streams video directly from file server.

## Run

```bash
cp .env.example .env  # set MEDIA_DIR and API_KEY
docker-compose up -d
# Install in Stremio: http://localhost:7001/manifest.json
```

## Verify

```bash
# Python syntax (no fastapi install needed on host)
python3 -c "import ast; ast.parse(open('file-server/server.py').read())"

# Node addon loads
cd addon && node -e "require('./lib/manifest'); console.log('OK')"

# Live health
curl http://localhost:3003/health

# Movie catalog
curl -H "X-API-Key: $KEY" http://localhost:7001/catalog/movie/local.json

# Series catalog
curl -H "X-API-Key: $KEY" http://localhost:7001/catalog/series/local.json

# Stream (with API key)
curl -H "X-API-Key: $KEY" "http://localhost:7001/stream/movie/FILENAME.json"
```

## Gotchas

- **Port 7000 blocked on macOS** — AirPlay占用. Addon listens on 7001. Do not change back to 7000.
- **ffmpeg must be apt-installed in runtime stage** — Can't copy binary from builder (shared libs missing). `COPY --from=builder /usr/bin/ffmpeg` breaks at runtime.
- **Health check uses Python urllib** — Slim images have no wget/curl. Don't use wget in healthcheck.
- **Two FILE_SERVER_URL vars** — `FILE_SERVER_URL` = Docker internal (`http://file-server:3003`). `FILE_SERVER_PUBLIC_URL` = client-facing (`http://localhost:3003`). Poster/stream URLs must use PUBLIC. API calls use internal.
- **Stremio SDK handlers return Promises** — Not callbacks. `module.exports = async function(args) { return { streams: [] } }`. Callback pattern silently fails with "handler error".
- **Media volume is `:ro`** — Read-only mount. No DELETE endpoint exposed.
- **API key auth** — Three methods: `X-API-Key` header, `Authorization: Bearer`, `?key=` query param. All checked in order.
- **Stream endpoint supports HEAD** — Required for ffprobe/hls-probe. Returns 200 with Content-Type/Content-Length, no body. Don't remove HEAD method.
- **Content-Type must match extension** — Browser/player fails with `application/octet-stream`. Use correct MIME from `VIDEO_EXTENSIONS` or `SUBTITLE_EXTENSIONS` dict.
- **CI: native arm64 runners** — QEMU emulation too slow. Workflow uses `ubuntu-24.04-arm` for arm64 builds. Don't switch back to QEMU.
- **CI: per-arch builds + manifest merge** — Each arch builds separately, pushes by digest, merge job combines into multi-arch manifest. Don't use `platforms: linux/amd64,linux/arm64` in single build step.
- **Series IDs use `__series__` prefix** — Series show IDs are `__series__{title}`. Stream/meta handlers must match on `flatPath` for episodes, not show ID.
- **Subtitle matching by stem prefix** — `Movie.mp4` matches `Movie.eng.srt`, `Movie.spa.srt`, `Movie.forced.eng.srt`. Subtitle stem must start with video stem (case-insensitive).
- **SOURCE_DIRS overrides SOURCE_DIR** — If `SOURCE_DIRS` env var is set (comma-separated), it takes priority over `SOURCE_DIR`.
- **File dedup by full path** — Dedup key is `{root}:{relpath}`, not basename. Prevents collisions across directories.

## Content Detection

File server classifies each video as `movie` or `series`:

- `S01E01`, `01x01` in filename → series
- 3+ path levels + season folder (`Season N`, `S01`, `Temporada N`, `Saison N`, `Staffel N`, `Stagione N`) → series
- Everything else → movie
- Season folders support English, Spanish, French, German, Italian names

Each file in `/api/list` includes: `type`, `title` (show name), `season`, `episode`, `subtitles[]`, `sourceDir`.

## Structure

```
file-server/
  server.py          # FastAPI app, single file (scanner, streaming, thumbnails, subtitle detection)
  requirements.txt   # fastapi, uvicorn, aiofiles, python-multipart
  Dockerfile         # multi-stage Python 3.11-slim + ffmpeg

addon/
  index.js           # entry, wires handlers to SDK
  lib/manifest.js    # Stremio manifest (movie + series catalogs)
  lib/catalog.js     # defineCatalogHandler — splits movie/series from /api/list
  lib/meta.js        # defineMetaHandler — series: episodes array; movie: single meta
  lib/stream.js      # defineStreamHandler — returns file server URL + subtitles
  package.json       # stremio-addon-sdk
  Dockerfile         # multi-stage Node 20-alpine

docker-compose.yml   # both services, read-only media mount
```
