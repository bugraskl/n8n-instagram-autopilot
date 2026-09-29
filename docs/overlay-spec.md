# Overlay and typography spec

The look of every post and story comes from two transparent PNG overlays plus one display font.
The renderer (`scripts/render_frame.sh`, GraphicsMagick) puts the photo underneath, the overlay on top,
then two lines of text.

## Canvas sizes

| Format | Canvas | Aspect | Overlay file |
|---|---|---|---|
| Feed post | 2304 x 2880 | 4:5 | `assets/post_overlay.png` |
| Story | 2160 x 3840 | 9:16 | `assets/story_overlay.png` |

Overlays are resized to the canvas if they differ, but design them at these sizes. A resized copy is cached
next to the overlay as `*_WxH.miff` and rebuilt automatically when the PNG changes.

## What goes on the overlay

- **Logo at the top**, centred. Note where it ends: that y value is `*_LOGO_BOTTOM` in `layout.env`.
- **Footer box at the bottom** (address, opening hours, website). The AI reframe prompt keeps the bottom
  ~8% (post) / ~7% (story) free of important food detail for it.
- Everything else transparent.

Instagram covers parts of a story with its own UI (profile row at the top, reply bar at the bottom), so keep
important content inside the middle of the story canvas.

## Text block

```text
            ┌──────────────── LOGO ────────────────┐
            └──────────────────────────────────────┘   <- LOGO_BOTTOM (slogan never goes above)
                  Charred edges, juicy centre            <- white slogan, grows UPWARD (1 or 2 lines)
                                                         <- GAP
   DISH_TOP ->    Your Brand Grilled Chicken Wrap        <- accent product line, top edge is FIXED
```

- **Slogan** (white): the AI headline. Rendered at 260 pt, trimmed, sheared (italic, `12x0`), then scaled
  to a fixed optical height (`SLOGAN_H`), so short and long headlines look the same size. If it is wider than
  86% of the canvas it is split into two lines.
- **Product line** (accent colour, default `#E63946`): `product_prefix` + dish name without parentheses.
  Its top edge is fixed at `DISH_TOP`; the slogan block grows upward from there. If the slogan would reach
  into the logo, the whole block moves down.
- **Readability scrim**: the average brightness of the text band is measured. Above ~18% grey a soft dark
  gradient (up to 70%) is laid behind the text.
- One font for both lines. Any TTF/OTF display font works (a condensed or rounded sans looks good).
  The font used in production is not shipped; supply your own at `assets/font.ttf` or set `font_path`.

## Defaults (`layout.env`)

| Key | Post | Story | Meaning |
|---|---|---|---|
| `*_DISH_TOP` | 912 | 964 | top edge of the product line |
| `*_GAP` | 44 | 30 | gap between slogan and product line |
| `*_SLOGAN_H` | 104 | 104 | optical height of a slogan line |
| `*_DISH_H` | 120 | 156 | optical height of the product line |
| `*_LOGO_BOTTOM` | 700 | 810 | lowest pixel of the logo |

Copy `examples/data-dir/assets/layout.env` to `<data_dir>/assets/layout.env` and change the numbers to fit
your artwork. `render_one.sh` sources it if it exists.

The AI reframe asks for an empty top area of 34% (post) / 30% (story), so with the defaults the text sits on
dark, empty background. If you move the text block much lower, also change `pct` in the
**Build Reframe Request** node.

## Reel end card

`render_reel.js` builds the closing card from a blurred, darkened frame plus:

- `assets/logo.png` (optional): transparent logo, resized to 440 px wide, placed near the top.
- the closing question (white) + call to action (accent).
- `assets/end_box.png` (optional): your footer box, resized to 952 px wide, placed in the middle where the
  Reels UI does not cover it. Cut it from the story overlay, for example:

  ```sh
  gm convert assets/story_overlay.png -crop 1905x476+128+3271 +repage assets/end_box.png
  ```

Reel text uses the same font, shear and colours as the stills (`font_path`, `slogan_color`, `accent_color`).

## Placeholder assets

No artwork yet? Generate placeholders (grey "LOGO" boxes and a footer bar) to test the whole pipeline:

```sh
sh scripts/make_placeholder_assets.sh /path/to/any-font.ttf /data/downloads/instagram/assets "your-site.example.com | Open daily"
```

It writes `post_overlay.png`, `story_overlay.png`, `logo.png` and `end_box.png` with the default geometry
above. Run it where `gm` is available (for example `docker exec -it n8n sh`).

## Why MIFF

All intermediate files are GraphicsMagick's native MIFF format. With PNG intermediates a single render was
about 10x slower and ran past n8n's 300 s limit for the Code node that calls the script.
