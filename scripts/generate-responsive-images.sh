#!/usr/bin/env bash
# Generate width-based PNG variants for responsive srcset (run on macOS; uses sips).
# Usage: from repo root: bash scripts/generate-responsive-images.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/img/responsive"
mkdir -p "$OUT"

resample_width() {
  local src="$1" dest="$2" w="$3"
  sips --resampleWidth "$w" "$src" --out "$dest" >/dev/null
}

echo "Writing responsive rasters to $OUT ..."

# Hero (780×646): mobile / tablet / full
resample_width "$ROOT/assets/img/hero-img.png" "$OUT/hero-img-400w.png" 400
resample_width "$ROOT/assets/img/hero-img.png" "$OUT/hero-img-520w.png" 520
resample_width "$ROOT/assets/img/hero-img.png" "$OUT/hero-img-780w.png" 780

# Skills (1024×630)
resample_width "$ROOT/assets/img/skills.png" "$OUT/skills-400w.png" 400
resample_width "$ROOT/assets/img/skills.png" "$OUT/skills-640w.png" 640
resample_width "$ROOT/assets/img/skills.png" "$OUT/skills-1024w.png" 1024

# Case study thumbnails (1920×1080)
for base in marinau-case-study nagy-case-study dumitrescu-case-study tslaw-case-study; do
  src="$ROOT/assets/img/portfolio/${base}.png"
  resample_width "$src" "$OUT/${base}-480w.png" 480
  resample_width "$src" "$OUT/${base}-960w.png" 960
  resample_width "$src" "$OUT/${base}-1440w.png" 1440
  resample_width "$src" "$OUT/${base}-1920w.png" 1920
done

# Dumitrescu case study asset (same aspect)
resample_width "$ROOT/assets/img/ald-studiu-de-caz.png" "$OUT/ald-studiu-de-caz-480w.png" 480
resample_width "$ROOT/assets/img/ald-studiu-de-caz.png" "$OUT/ald-studiu-de-caz-960w.png" 960
resample_width "$ROOT/assets/img/ald-studiu-de-caz.png" "$OUT/ald-studiu-de-caz-1440w.png" 1440
resample_width "$ROOT/assets/img/ald-studiu-de-caz.png" "$OUT/ald-studiu-de-caz-1920w.png" 1920

echo "Done."
