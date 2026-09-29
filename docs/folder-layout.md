# Folder layout and file formats

Everything the workflows read and write lives in one folder, `data_dir` in the Config nodes
(default `/data/downloads/instagram`, a path **inside** the n8n container).

```text
<data_dir>/
├── photos/                  your food photos (jpg / png / webp)            <- you
├── assets/
│   ├── post_overlay.png     2304x2880 transparent PNG (logo + footer box)   <- you
│   ├── story_overlay.png    2160x3840 transparent PNG                       <- you
│   ├── font.ttf             any TTF/OTF display font (not shipped)          <- you
│   ├── logo.png             transparent logo for the reel end card (opt.)   <- you
│   ├── end_box.png          footer box for the reel end card (optional)     <- you
│   └── layout.env           text positions for YOUR overlays (optional)     <- you
├── scripts/
│   ├── render_one.sh        renders one post or story                       <- copy from repo
│   ├── render_frame.sh      the GraphicsMagick compositor                   <- copy from repo
│   └── render_reel.js       the ffmpeg reel montage                         <- copy from repo
├── state/
│   ├── menu.json            products that may be published                  <- you
│   ├── photo_dishes.json    photo -> dish catalog                           <- you (optional)
│   ├── photo_overrides.json manual fixes for photos sent to review          <- you, when asked
│   ├── ledger.json          every post/story (created automatically)
│   └── reels_ledger.json    every reel (created automatically)
├── music/
│   ├── library.json         approved reel tracks                            <- you
│   └── *.mp3                                                                <- you
├── work/                    intermediates: AI reframes, reel work folders
└── out/                     final JPG / MP4 / cover files, served by the media server
```

`examples/data-dir/` in this repo is a starter copy of the files marked "you".

## Getting the folder into n8n (Docker)

Bind-mount a host folder and allow the Node built-ins the Code nodes use:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest          # includes GraphicsMagick (gm); ffmpeg is NOT included
    environment:
      - NODE_FUNCTION_ALLOW_BUILTIN=fs,crypto,child_process
      - GENERIC_TIMEZONE=Europe/London   # your timezone: schedules and email dates use it
    volumes:
      - ./n8n_data:/home/node/.n8n
      - ./downloads:/data/downloads      # data_dir = /data/downloads/instagram
```

ffmpeg: put a static Linux build (for example from johnvansickle.com/ffmpeg) at
`./downloads/bin/ffmpeg` on the host, `chmod +x` it, and keep `ffmpeg_path` = `/data/downloads/bin/ffmpeg`.
It needs the `perspective`, `xfade`, `gblur`, `geq`, `loudnorm` filters and `libx264` (static builds have them).

The container user (`node`, uid 1000 in the official image) must be able to write to the folder.

## state/menu.json

```json
{ "items": ["Margherita Pizza", "Grilled Chicken Wrap", "Lemon Tart"] }
```

The AI may only name a dish from this list. Use the names exactly as you want them printed
(anything in parentheses is dropped on the image and in hashtags: `"Chicken Wrap (with fries)"` prints as
`Chicken Wrap`).

## state/photo_dishes.json (photo -> dish catalog)

```json
{
  "version": 1,
  "photos": {
    "IMG_0001.jpg": { "dish": "Margherita Pizza", "source": "confirmed" },
    "IMG_0002.jpg": { "dish": "Grilled Chicken Wrap", "source": "ai_consensus" },
    "IMG_0003.jpg": { "dish": "", "source": "skipped" }
  }
}
```

| `source` | Meaning |
|---|---|
| `confirmed` | Checked by a person. Always wins over the AI. |
| `ai_consensus` | Two different models agreed on the name. Also trusted. |
| `skipped` | Never publish this photo (blurry, off-brand, duplicate...). |
| anything else | Ignored: the AI guess is used, and it must be on the menu with confidence >= 0.9. |

Photos with a known dish are picked first, so risky photos wait until the known ones are used up.
Why a catalog at all: in production, two strong vision models disagreed on the dish name for 52% of
66 photos. Naming by AI alone was not reliable enough to publish unattended.

## state/photo_overrides.json

When a photo is sent to review (Telegram message), add the correct name and the photo is retried first
on the next run:

```json
{ "IMG_0042.jpg": "Lamb Skewers" }
```

## state/ledger.json

One entry per run, keyed by `base` (`auto_<kind>_<timestamp>_<hash8>`). A photo counts as used as soon as
it has an entry (by SHA-256 of the file), except `dry_run` entries and `review` entries that have an override.

| Status | Set by | Meaning |
|---|---|---|
| `reserved` | Pick Photo | photo picked, nothing checked yet |
| `checked` | Validate Analysis | dish accepted, copy candidates exist |
| `validated` | Save Approved Copy | copy approved (Jev scores stored under `jev`) |
| `ready` | Render Image | JPG rendered (`framed`, `frameCheck` = AI reframe verdict) |
| `published` | Save Published | live on Instagram (`mediaId`) |
| `review` | Validate Analysis / Final Copy Decision | not published, `reason` says why |
| `dry_run` | Dry Run: Mark Ledger | rendered only; photo stays available |

See `examples/reference/ledger.json` for a full entry.

## state/reels_ledger.json

`reserved -> rendering -> ready -> published` (or `dry_run`). Stores the frames, dishes, chosen script and
its scores, music, Veo verdict, video size and the story result. The frames of the last two reels are avoided
when possible. See `examples/reference/reels_ledger.json`.

## music/library.json

```json
{
  "version": 1,
  "tracks": {
    "track-01.mp3": { "uses": 0, "lastUsed": null },
    "track-02.mp3": { "uses": 0, "lastUsed": null, "disabled": true }
  }
}
```

The least-used enabled track whose file exists is picked each week, then `uses` / `lastUsed` are updated.
No tracks is fine: the reel then only has the opener's own sound (or none). No music ships with this repo;
use tracks you have the rights to. Extra fields (source, who approved it, evaluation notes) are kept as-is.
