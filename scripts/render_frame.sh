#!/bin/sh
# Still-image compositor (GraphicsMagick) for Instagram posts and stories.
#
# - Typography: every line is rendered at a large point size and scaled to a fixed optical
#   height, so the text size does not depend on the text length.
# - Block layout: the TOP edge of the product line is a fixed anchor; the white slogan grows upward.
#   If the slogan would run into the logo, the whole block moves down.
# - Readability: the brightness behind the text band is measured; if it is too bright a soft
#   dark scrim is applied.
# - All intermediate files are MIFF: PNG intermediates were ~10x slower and pushed a single render
#   past n8n's 300 s Code-node limit.
#
# Usage:
#   render_frame.sh PHOTO OVERLAY W H "SLOGAN" "DISH" OUT DISH_TOP GAP SLOGAN_H DISH_H LOGO_BOTTOM
#
# Environment (all optional):
#   IG_DATA_DIR        data root (default: parent folder of this script's folder)
#   IG_FONT            TTF/OTF display font (default: $IG_DATA_DIR/assets/font.ttf)
#   IG_PRODUCT_PREFIX  text put in front of the dish on the product line, e.g. your brand (default: none)
#   IG_SLOGAN_COLOR    slogan colour (default: #FFFFFF)
#   IG_ACCENT_COLOR    product line colour (default: #E63946)
#   IG_SLANT           italic shear passed to gm -shear (default: 12x0)
set -e

RAW="$1"; OV="$2"; W="$3"; H="$4"; SLOGAN="$5"; DISH="$6"; OUT="$7"
DISH_TOP="${8:-912}"    # top edge of the product line (fixed anchor)
GAP="${9:-44}"          # space between slogan bottom and product line top
SLO_H="${10:-104}"      # optical height of a slogan line
DISH_H="${11:-120}"     # optical height of the product line
LOGO_BOT="${12:-700}"   # bottom edge of the logo; the slogan never goes above it

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${IG_DATA_DIR:-$(dirname "$HERE")}"
FONT="${IG_FONT:-$ROOT/assets/font.ttf}"
WHITE="${IG_SLOGAN_COLOR:-#FFFFFF}"
RED="${IG_ACCENT_COLOR:-#E63946}"
SLANT="${IG_SLANT:-12x0}"
PREFIX="${IG_PRODUCT_PREFIX:-}"
MAXW=$(( W * 86 / 100 ))

[ -f "$FONT" ] || { echo "Font not found: $FONT (put any TTF/OTF display font there or set IG_FONT)" >&2; exit 2; }
[ -f "$OV" ] || { echo "Overlay not found: $OV" >&2; exit 2; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Product line: optional prefix (e.g. the brand) + dish name without anything in parentheses.
# A leading "@" would make gm read a file, so it is stripped from both texts.
DISH_TEXT=$(printf '%s' "$DISH" | sed 's/ *(.*)//; s/^@*//')
if [ -n "$PREFIX" ]; then
  case "$DISH_TEXT" in
    "$PREFIX"*) : ;;
    *) DISH_TEXT="$PREFIX $DISH_TEXT" ;;
  esac
fi

# 1) Base photo: fix EXIF orientation and fill the canvas.
#    Gravity South keeps the food low and leaves the top free for text.
gm convert "$RAW" -auto-orient +profile "*" "$TMP/src.miff"
SW=$(gm identify -format '%w' "$TMP/src.miff"); SH=$(gm identify -format '%h' "$TMP/src.miff")
# If the source already has the target aspect ratio (an AI reframe), do not crop
RATIO_SRC=$(( SW * 1000 / SH )); RATIO_DST=$(( W * 1000 / H ))
DIFF=$(( RATIO_SRC - RATIO_DST )); [ "$DIFF" -lt 0 ] && DIFF=$(( -DIFF ))
if [ "$DIFF" -le 35 ]; then
  gm convert "$TMP/src.miff" -resize ${W}x${H}! "$TMP/base.miff"
else
  gm convert "$TMP/src.miff" -resize ${W}x${H}^ -gravity South -extent ${W}x${H} "$TMP/base.miff"
fi

# 2) Text layers: render big, then scale to the target optical height.
render_line() { # $1=text $2=color $3=target_h $4=maxw $5=out
  gm convert -background none -fill "$2" -font "$FONT" -pointsize 260 \
    -size $(( $4 * 4 ))x caption:"$1" -trim +repage "$TMP/_r.miff"
  gm convert "$TMP/_r.miff" -background none -shear "$SLANT" +repage "$TMP/_s.miff"
  rw=$(gm identify -format '%w' "$TMP/_s.miff"); rh=$(gm identify -format '%h' "$TMP/_s.miff")
  th=$3
  tw=$(( rw * th / rh ))
  if [ "$tw" -gt "$4" ]; then tw=$4; th=$(( rh * tw / rw )); fi
  gm convert "$TMP/_s.miff" -resize ${tw}x${th}! "$5"
}

SLOGAN_TXT=$(printf '%s' "$SLOGAN" | sed 's/  */ /g; s/^@*//')
render_line "$SLOGAN_TXT" "$WHITE" "$SLO_H" "$MAXW" "$TMP/slo1.miff"
render_line "$DISH_TEXT" "$RED" "$DISH_H" "$MAXW" "$TMP/dish.miff"

# If the slogan does not fit on one line, split it into two and re-scale
SLO_W=$(gm identify -format '%w' "$TMP/slo1.miff")
if [ "$SLO_W" -ge "$MAXW" ]; then
  WORDS=$(printf '%s' "$SLOGAN_TXT" | wc -w)
  HALF=$(( (WORDS + 1) / 2 ))
  L1=$(printf '%s' "$SLOGAN_TXT" | cut -d' ' -f1-${HALF})
  L2=$(printf '%s' "$SLOGAN_TXT" | cut -d' ' -f$(( HALF + 1 ))-)
  render_line "$L1" "$WHITE" "$SLO_H" "$MAXW" "$TMP/sl_a.miff"
  render_line "$L2" "$WHITE" "$SLO_H" "$MAXW" "$TMP/sl_b.miff"
  AW=$(gm identify -format '%w' "$TMP/sl_a.miff"); BW=$(gm identify -format '%w' "$TMP/sl_b.miff")
  AH=$(gm identify -format '%h' "$TMP/sl_a.miff"); BH=$(gm identify -format '%h' "$TMP/sl_b.miff")
  CW=$AW; [ "$BW" -gt "$CW" ] && CW=$BW
  LEAD=$(( SLO_H * 38 / 100 ))
  CH=$(( AH + LEAD + BH ))
  gm convert -size ${CW}x${CH} xc:none "$TMP/slo.miff"
  gm composite -gravity North -geometry +0+0 "$TMP/sl_a.miff" "$TMP/slo.miff" "$TMP/slo_t.miff"
  gm composite -gravity North -geometry +0+$(( AH + LEAD )) "$TMP/sl_b.miff" "$TMP/slo_t.miff" "$TMP/slo.miff"
else
  cp "$TMP/slo1.miff" "$TMP/slo.miff"
fi

SLO_HH=$(gm identify -format '%h' "$TMP/slo.miff")
DISH_HH=$(gm identify -format '%h' "$TMP/dish.miff")
SLO_TOP=$(( DISH_TOP - GAP - SLO_HH ))

# If the slogan would reach into the logo, move the whole block down (the product line moves too)
SHIFT=0
if [ "$SLO_TOP" -lt "$LOGO_BOT" ]; then
  SHIFT=$(( LOGO_BOT - SLO_TOP ))
  SLO_TOP=$LOGO_BOT
fi
DISH_TOP_FINAL=$(( DISH_TOP + SHIFT ))

# 3) Readability scrim: if the band behind the text is bright, apply a soft dark gradient.
BAND_TOP=$(( SLO_TOP - 40 )); [ "$BAND_TOP" -lt 0 ] && BAND_TOP=0
BAND_BOT=$(( DISH_TOP_FINAL + DISH_HH + 40 )); [ "$BAND_BOT" -gt "$H" ] && BAND_BOT=$H
BAND_H=$(( BAND_BOT - BAND_TOP ))
# -depth 8 keeps the value on a 0-255 scale on both Q8 and Q16 GraphicsMagick builds
MEAN=$(gm convert "$TMP/base.miff" -crop ${W}x${BAND_H}+0+${BAND_TOP} +repage -colorspace GRAY -scale 1x1! -depth 8 txt:- 2>/dev/null | sed -n '1s/.*(  *\([0-9][0-9]*\).*/\1/p')
[ -z "$MEAN" ] && MEAN=0
# MEAN is 0-255. Above 46 (~18%) the text background is too bright -> soft scrim
if [ "$MEAN" -gt 46 ]; then
  OP=$(( (MEAN - 46) * 45 / 25 )); [ "$OP" -gt 70 ] && OP=70
  FADE=$(( BAND_H / 3 )); [ "$FADE" -lt 1 ] && FADE=1
  MID=$(( BAND_H - FADE - FADE )); [ "$MID" -lt 1 ] && MID=1
  gm convert -size ${W}x${BAND_H} xc:black "$TMP/blk.miff"
  gm convert -size ${W}x${FADE} gradient:black-white "$TMP/g_top.miff"
  gm convert -size ${W}x${MID} xc:white "$TMP/g_mid.miff"
  gm convert -size ${W}x${FADE} gradient:white-black "$TMP/g_bot.miff"
  gm convert "$TMP/g_top.miff" "$TMP/g_mid.miff" "$TMP/g_bot.miff" -append "$TMP/mask.miff"
  gm composite -compose CopyOpacity "$TMP/mask.miff" "$TMP/blk.miff" "$TMP/scrim.miff"
  gm composite -dissolve ${OP} -geometry +0+${BAND_TOP} "$TMP/scrim.miff" "$TMP/base.miff" "$TMP/base2.miff"
  mv "$TMP/base2.miff" "$TMP/base.miff"
fi

# 4) Overlay (logo + footer box), cached per size next to the overlay file
OVC="${OV%.*}_${W}x${H}.miff"
if [ ! -f "$OVC" ] || [ "$OV" -nt "$OVC" ]; then
  gm convert "$OV" -resize ${W}x${H}! "$OVC.tmp" && mv "$OVC.tmp" "$OVC"
fi
gm composite -gravity center "$OVC" "$TMP/base.miff" "$TMP/c.miff"

# 5) Text on top (horizontally centred): first a soft offset copy, then the text itself.
#    Note: this gm build has no "-channel Alpha", so soft_shadow falls back to a plain copy.
soft_shadow() { # $1=src $2=out
  gm convert "$1" -channel Alpha -blur 0x6 -fill black -colorize 100 "$2" 2>/dev/null || cp "$1" "$2"
}
soft_shadow "$TMP/slo.miff" "$TMP/slo_sh.miff"
soft_shadow "$TMP/dish.miff" "$TMP/dish_sh.miff"
gm composite -dissolve 70 -gravity North -geometry +0+$(( SLO_TOP + 5 )) "$TMP/slo_sh.miff" "$TMP/c.miff" "$TMP/c1.miff"
gm composite -dissolve 70 -gravity North -geometry +0+$(( DISH_TOP_FINAL + 5 )) "$TMP/dish_sh.miff" "$TMP/c1.miff" "$TMP/c2.miff"
gm composite -gravity North -geometry +0+${SLO_TOP} "$TMP/slo.miff" "$TMP/c2.miff" "$TMP/c3.miff"
gm composite -gravity North -geometry +0+${DISH_TOP_FINAL} "$TMP/dish.miff" "$TMP/c3.miff" "$TMP/c4.miff"

gm convert "$TMP/c4.miff" +profile "*" -quality 92 "$OUT"
echo "OK $OUT (mean=$MEAN slogan_top=$SLO_TOP slogan_h=$SLO_HH dish_top=$DISH_TOP_FINAL dish_h=$DISH_HH shift=$SHIFT)"
