#!/bin/sh
# Renders ONE format for a photo: a feed post (2304x2880, 4:5) OR a story (2160x3840, 9:16).
# Each workflow run only produces the format it is publishing that day.
#
# Usage:   render_one.sh post|story PHOTO NAME "SLOGAN" "DISH"
# Output:  $IG_DATA_DIR/out/NAME.jpg
#
# Environment (all optional):
#   IG_DATA_DIR   data root (default: parent folder of this script's folder)
#   plus everything render_frame.sh understands (IG_FONT, IG_PRODUCT_PREFIX, IG_SLOGAN_COLOR, ...)
#
# Layout numbers depend on your overlay artwork (where the logo ends, where the footer box sits).
# Defaults below match the reference overlays; override any of them in $IG_DATA_DIR/assets/layout.env
# (see examples/layout.env and docs/overlay-spec.md).
set -e
KIND="$1"; RAW="$2"; NAME="$3"; SLOGAN="$4"; DISH="$5"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${IG_DATA_DIR:-$(dirname "$HERE")}"
export IG_DATA_DIR="$ROOT"

POST_W=2304;  POST_H=2880;  POST_OVERLAY=post_overlay.png
POST_DISH_TOP=912;  POST_GAP=44;  POST_SLOGAN_H=104;  POST_DISH_H=120;  POST_LOGO_BOTTOM=700
STORY_W=2160; STORY_H=3840; STORY_OVERLAY=story_overlay.png
STORY_DISH_TOP=964; STORY_GAP=30; STORY_SLOGAN_H=104; STORY_DISH_H=156; STORY_LOGO_BOTTOM=810
if [ -f "$ROOT/assets/layout.env" ]; then . "$ROOT/assets/layout.env"; fi

[ -f "$RAW" ] || { echo "Photo not found: $RAW" >&2; exit 2; }
mkdir -p "$ROOT/out"
OUT="$ROOT/out/${NAME}.jpg"

#                                                                W          H          SLOGAN      DISH     OUT     DISH_TOP          GAP          SLOGAN_H          DISH_H          LOGO_BOTTOM
if [ "$KIND" = "post" ]; then
  sh "$HERE/render_frame.sh" "$RAW" "$ROOT/assets/$POST_OVERLAY"  "$POST_W"  "$POST_H"  "$SLOGAN" "$DISH" "$OUT" "$POST_DISH_TOP"  "$POST_GAP"  "$POST_SLOGAN_H"  "$POST_DISH_H"  "$POST_LOGO_BOTTOM"
elif [ "$KIND" = "story" ]; then
  sh "$HERE/render_frame.sh" "$RAW" "$ROOT/assets/$STORY_OVERLAY" "$STORY_W" "$STORY_H" "$SLOGAN" "$DISH" "$OUT" "$STORY_DISH_TOP" "$STORY_GAP" "$STORY_SLOGAN_H" "$STORY_DISH_H" "$STORY_LOGO_BOTTOM"
else
  echo "KIND must be 'post' or 'story', got: $KIND" >&2; exit 2
fi
echo "OK ${KIND} ${NAME}"
