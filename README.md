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
| `MEDIA_DIR` | Media directory path (single) | `/path/to/media` |
| `SOURCE_DIRS` | Multiple directories (comma-separated, overrides `MEDIA_DIR`) | (none) |
| `API_KEY` | Shared API key | (none) |
| `PORT` | Addon port | `7001` |

## Supported Formats

**Video:** `.mp4` `.mkv` `.avi` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.mpg` `.mpeg` `.3gp` `.ogv` `.ts` `.m2ts`

**Subtitles:** `.srt` `.ass` `.sub` `.ssa`

## Series Support

Folder-based season/episode parsing. Addon exposes both "movie" and "series" catalogs.

### Folder Structure

```
Media/
├── Movies/
│   └── Inception.mp4          # → movie
├── Breaking Bad/
│   ├── Season 1/
│   │   ├── S01E01 - Pilot.mkv   # → series, S1E1
│   │   └── S01E01.eng.srt       # → subtitle
│   └── Season 2/
│       └── S02E03.mkv           # → series, S2E3
├── Anime/
│   └── S01E05.mkv              # → series (SxxExx in filename)
└── S02E10.mkv                   # → series (root level)
```

### Detection Rules

- `SxxExx` or `01x01` in filename → series
- 3+ path levels + season folder (`Season N`, `S01`, `Temporada N`, `Saison N`, `Staffel N`, `Stagione N`) → series
- Season folder supports English, Spanish, French, German, Italian

### Subtitle Detection

Subtitle files matched to videos by filename stem prefix in same directory:

```
Movie.mp4          + Movie.eng.srt      → English subtitle
Movie.mp4          + Movie.spa.srt      → Spanish subtitle
Movie.mp4          + Movie.srt          → language from filename
```

Language codes: `.eng` → English, `.es`/`.spa` → Spanish, `.fr` → French, `.de` → German, `.pt` → Portuguese, `.ja` → Japanese, `.ko` → Korean, `.zh` → Chinese, and more.

## Multi-Directory Support

Serve multiple media directories. Set `SOURCE_DIRS` env var:

```bash
SOURCE_DIRS=/media/tv,/media/movies,/media/anime
```

Each path must be mounted in `docker-compose.yml`:

```yaml
volumes:
  - /host/tv:/media/tv:ro
  - /host/movies:/media/movies:ro
  - /host/anime:/media/anime:ro
environment:
  - SOURCE_DIRS=/media/tv,/media/movies,/media/anime
```

## TODO

- [x] Series type support (folder-based season/episode parsing)
- [x] Subtitle detection (`.srt`/`.ass` alongside videos)
- [x] Multi-directory support
- [x] TMDB metadata support
- [ ] OpenSubtitles subtitle support
