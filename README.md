# Stremio Local File Server

Stream local media files in Stremio via an HTTP file server.

## Architecture

```
Stremio → Addon (Node.js:7000) → File Server (Python:3003) → Local Disk
```

- **Addon** serves the Stremio protocol (catalog, streams)
- **File Server** serves video files with range request support and thumbnail extraction

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env: set MEDIA_DIR to your media folder

# 2. Run
docker-compose up -d

# 3. Install in Stremio
# Open: http://localhost:7001/manifest.json
```

## Manual Setup

### File Server

```bash
cd file-server
pip install -r requirements.txt
python server.py /path/to/media --port 3003 --api-key mysecret
```

### Addon

```bash
cd addon
npm install
FILE_SERVER_URL=http://localhost:3003 FILE_SERVER_API_KEY=mysecret PORT=7001 node index.js
```

## API

### File Server

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/list` | List video files |
| `GET /api/thumbnail/{filename}` | Video thumbnail |
| `GET /{path}` | Stream video (range requests) |

### Authentication

API key via:
- `X-API-Key` header
- `Authorization: Bearer <key>`
- `?key=<key>` query param

## Configuration

| Variable | Description | Default |
|---|---|---|
| `MEDIA_DIR` | Media directory path | `/path/to/media` |
| `API_KEY` | Shared API key | (none) |
| `PORT` | Addon port | `7001` |

## Supported Formats

`.mp4` `.mkv` `.avi` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.mpg` `.mpeg` `.3gp` `.ogv` `.ts` `.m2ts`

## TODO

- [ ] Series type support (folder-based season/episode parsing)
- [ ] Subtitle detection (`.srt`/`.ass` alongside videos)
- [ ] Multi-directory support
