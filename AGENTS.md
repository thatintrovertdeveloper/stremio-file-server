# AGENTS.md

## Architecture

Two independent services communicating over HTTP:

- **file-server** (`file-server/server.py`) — Python/FastAPI. Serves video files with range requests, extracts thumbnails via FFmpeg, background file scanner (1s interval).
- **addon** (`addon/index.js`) — Node.js. Stremio addon SDK. Fetches file list from file server, serves catalog + stream handlers to Stremio.

Stremio connects to addon → addon calls file server API → Stremio streams video directly from file server.

## Run

```bash
cp .env.example .env  # set MEDIA_DIR and API_KEY
docker-compose up -d
# Install in Stremio: http://localhost:7001/manifest.json
```

## Gotchas

- **Port 7000 blocked on macOS** — AirPlay占用. Addon listens on 7001. Do not change back to 7000.
- **ffmpeg must be apt-installed in runtime stage** — Can't copy binary from builder (shared libs missing). `COPY --from=builder /usr/bin/ffmpeg` breaks at runtime.
- **Health check uses Python urllib** — Slim images have no wget/curl. Don't use wget in healthcheck.
- **Two FILE_SERVER_URL vars** — `FILE_SERVER_URL` = Docker internal (`http://file-server:3003`). `FILE_SERVER_PUBLIC_URL` = client-facing (`http://localhost:3003`). Poster/stream URLs must use PUBLIC. API calls use internal.
- **Stremio SDK handlers return Promises** — Not callbacks. `module.exports = async function(args) { return { streams: [] } }`. Callback pattern silently fails with "handler error".
- **Media volume is `:ro`** — Read-only mount. No DELETE endpoint exposed.
- **API key auth** — Three methods: `X-API-Key` header, `Authorization: Bearer`, `?key=` query param. All checked in order.

## Verify

```bash
# Python syntax (no fastapi install needed on host)
python3 -c "import ast; ast.parse(open('file-server/server.py').read())"

# Node addon loads
cd addon && node -e "require('./lib/manifest'); console.log('OK')"

# Live health
curl http://localhost:3003/health

# Catalog (with API key)
curl -H "X-API-Key: $KEY" http://localhost:7001/catalog/movie/local.json

# Stream (with API key)
curl -H "X-API-Key: $KEY" "http://localhost:7001/stream/movie/FILENAME.json"
```

## Structure

```
file-server/
  server.py          # FastAPI app, single file
  requirements.txt   # fastapi, uvicorn, aiofiles, python-multipart
  Dockerfile         # multi-stage Python 3.11-slim + ffmpeg

addon/
  index.js           # entry, wires handlers to SDK
  lib/manifest.js    # Stremio manifest
  lib/catalog.js     # defineCatalogHandler — fetches /api/list
  lib/stream.js      # defineStreamHandler — returns file server URL
  package.json       # stremio-addon-sdk
  Dockerfile         # multi-stage Node 20-alpine

docker-compose.yml   # both services, read-only media mount
```
