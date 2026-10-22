#!/usr/bin/env bash
# Build the fixture media library used by the e2e checks.
#
# Idempotent: skips regeneration when the tree already exists. The layout
# deliberately exercises every naming form documented in AGENTS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIX="$ROOT/.qa/fixtures/media"

if [[ -f "$FIX/movies/Big.Buck.Bunny.2008.1080p.mp4" ]]; then
  echo "fixtures: already present at $FIX"
  exit 0
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg is required to generate fixtures" >&2; exit 1; }

mkdir -p "$FIX/tv/Breaking.Bad/Season 1" \
         "$FIX/tv/Dark/Temporada 1" \
         "$FIX/tv/Money.Heist/Season 2" \
         "$FIX/movies"

gen_video() {
  ffmpeg -y -loglevel error -f lavfi -i "testsrc=size=160x120:rate=10:duration=1" \
    -c:v libx264 -pix_fmt yuv420p "$1"
}

gen_video "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.mkv"
cp "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.mkv" \
   "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E02.720p.mkv"
cp "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.mkv" \
   "$FIX/tv/Dark/Temporada 1/Dark.01x01.mkv"
cp "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.mkv" \
   "$FIX/tv/Money.Heist/Season 2/Money.Heist.E05.mkv"

gen_video "$FIX/movies/Big.Buck.Bunny.2008.1080p.mp4"
cp "$FIX/movies/Big.Buck.Bunny.2008.1080p.mp4" \
   "$FIX/movies/Some.Movie.2024.incomplete.mp4"

printf '1\n00:00:00,000 --> 00:00:01,000\nEnglish sub\n' \
  > "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.eng.srt"
printf '1\n00:00:00,000 --> 00:00:01,000\nForced\n' \
  > "$FIX/tv/Breaking.Bad/Season 1/Breaking.Bad.S01E01.720p.forced.eng.srt"
# Must NOT be matched to Breaking.Bad.S01E01 — guards the stem-prefix rule.
printf '1\n00:00:00,000 --> 00:00:01,000\nWrong show\n' \
  > "$FIX/tv/Breaking.Bad/Season 1/Other.Show.S01E01.eng.srt"

echo "fixtures: generated at $FIX"
