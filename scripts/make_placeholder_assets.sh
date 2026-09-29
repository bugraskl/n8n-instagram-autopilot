#!/bin/sh
# Creates PLACEHOLDER design assets so you can test the pipeline before your real artwork exists:
#   post_overlay.png   2304x2880 transparent, "LOGO" box at the top + footer box at the bottom
#   story_overlay.png  2160x3840 transparent, same idea
#   logo.png           transparent logo for the reel end card
#   end_box.png        footer box for the reel end card (cut from the story overlay)
# Replace them with your own artwork later (keep the sizes; see docs/overlay-spec.md).
#
# Usage: make_placeholder_assets.sh FONT_FILE [ASSETS_DIR] ["FOOTER TEXT"]
#   ASSETS_DIR default: $IG_DATA_DIR/assets, or ../assets next to this script
# Needs GraphicsMagick (gm). Note: in GraphicsMagick "#RRGGBBAA" colours use OPACITY semantics,
# i.e. the last byte is transparency (00 = opaque, FF = invisible).
set -e
FONT="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${IG_DATA_DIR:-$(dirname "$HERE")}"
OUT="${2:-$ROOT/assets}"
FOOTER=$(printf '%s' "${3:-your-site.example.com  |  Open daily}" | tr -d "'")
[ -f "$FONT" ] || { echo "Usage: $0 FONT_FILE [ASSETS_DIR] [FOOTER_TEXT]  (font not found: $FONT)" >&2; exit 2; }
mkdir -p "$OUT"

BOX_FILL="#0000004D"     # black, ~70% opaque
LOGO_FILL="#FFFFFFCC"    # white, ~20% opaque

# $1=W $2=H $3=logo box "x0,y0 x1,y1" $4=logo centre y $5=footer box "x0,y0 x1,y1" $6=footer centre y $7=out
# (text is drawn with -gravity Center, so the y offsets are relative to the canvas centre)
overlay() {
  gm convert -size "$1x$2" xc:none \
    -fill "$LOGO_FILL" -stroke white -strokewidth 8 -draw "roundRectangle $3 40,40" \
    -stroke none -fill white -font "$FONT" -pointsize 190 -gravity Center -draw "text 0,$(( $4 - $2 / 2 )) 'LOGO'" \
    -gravity NorthWest -fill "$BOX_FILL" -draw "roundRectangle $5 36,36" \
    -fill white -pointsize 72 -gravity Center -draw "text 0,$(( $6 - $2 / 2 )) '$FOOTER'" \
    "$7"
}

# Post: logo ends above y=700 (POST_LOGO_BOTTOM), footer in the bottom ~10%
overlay 2304 2880 "702,170 1602,640" 405 "152,2570 2152,2790" 2680 "$OUT/post_overlay.png"
# Story: logo ends above y=810 (STORY_LOGO_BOTTOM), footer box at 1905x476+128+3271
overlay 2160 3840 "630,220 1530,740" 480 "128,3271 2033,3747" 3509 "$OUT/story_overlay.png"

# Reel end card assets
gm convert -size 900x440 xc:none -fill "$LOGO_FILL" -stroke white -strokewidth 8 -draw "roundRectangle 8,8 891,431 40,40" \
  -stroke none -fill white -font "$FONT" -pointsize 190 -gravity center -draw "text 0,0 'LOGO'" "$OUT/logo.png"
gm convert "$OUT/story_overlay.png" -crop 1905x476+128+3271 +repage "$OUT/end_box.png"

echo "Placeholder assets written to $OUT"
