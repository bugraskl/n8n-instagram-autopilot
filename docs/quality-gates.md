# Quality gates in detail

The rule of the whole system: **Gemini sees and writes, Jev decides, code enforces.**
Jev (`typesafe/jev-1.13`, via OpenRouter) is a typed decision model: it answers questions of type
`noul` (a true/false probability), `choice` (one of up to 255 options, with probabilities and confidence) or
`score` (2-10 ordered levels, returned as a weighted score from 0 to n-1). It never writes text and never
sees images, so everything it judges is text: the copy itself, or Gemini's written report about an image.

Every Jev call is optional. The HTTP nodes continue on error and every decision node has a fallback path,
and `jev_enabled: false` routes around them completely.

## 1. Dish identity (posts and stories) - no AI judge

| Source | Accepted when |
|---|---|
| `photo_overrides.json` | always (must be on the menu) |
| `photo_dishes.json` (`confirmed`, `ai_consensus`) | always (must be on the menu) |
| Gemini 3.1 Pro guess | on the menu **and** confidence >= 0.9 |

Otherwise: nothing is published, the ledger entry becomes `review`, and Telegram asks you to add the right
name to `photo_overrides.json`. Product identity is never delegated to Jev: in testing it picked the wrong
dish from Gemini's text description in 4 of 8 cases where Gemini itself was right with >= 0.9 confidence.

## 2. Copy rules (code, before any judge)

A candidate (headline + caption) is dropped with a named reason if:

- caption is empty, shorter than 35 or longer than 350 characters, or does not contain the dish name
- headline is empty, longer than `title_max_chars` (44) or `title_max_words` (5)
- headline repeats the dish name (it is already printed on the product line right below)
- it matches `prohibited_pattern` (prices, discounts, times...) or a `banned_phrases` entry
- the caption repeats one of the last 5 published captions

## 3. Copy scoring (Jev, one request per candidate)

Questions for a **post**:

| Key | Type | Asks | Weight | Gate (dropped if) |
|---|---|---|---|---|
| `dish_match` | noul | is the text about the named dish? | - | < 0.5 |
| `title_focus` | noul | is the headline about the dish itself (not garnish/plate)? | 0.25 | - |
| `title_appeal` | score 0-3 | appetizing and specific? | 0.25 | - |
| `title_grammar` | score 0-3 | natural `language` in the headline? | 0.15 | < 1.5 |
| `caption_grammar` | score 0-3 | natural `language` in the caption? | 0.15 | < 1.5 |
| `caption_grounded` | noul | every detail in the caption is visible in the photo? | 0.10 | < 0.35 |
| `caption_appeal` | score 0-3 | vivid, not a list of plates? | 0.10 | - |
| `main_issue` | choice | the single biggest problem | hint only | never |

A **story** shows only the headline: `title_focus` 0.35, `title_appeal` 0.40, `title_grammar` 0.25;
gates `dish_match` < 0.5 and `title_grammar` < 1.5. Scores are normalised (`score / 3`) before weighting.

`main_issue` is used only as a revision hint: it always picks *some* issue (usually "cliché"), even for good
copy, so it must never block publishing.

**Decision**

- Best eligible candidate >= `jev_min_score` (0.80) -> publish it.
- Otherwise one revision round: Jev's diagnoses are turned into concrete instructions
  (`DIRECTIVES` in the code) and Gemini Flash writes three new candidates. They go through the same rules and
  the same Jev questions, and **both rounds compete**; the best eligible candidate is published even if it is
  below 0.80.
- No eligible candidate at all -> no post, `review`, Telegram message with the reasons.
- Jev unreachable or disabled -> candidates are not dropped (they already passed the rules) and the first one
  is used: the behaviour before Jev existed.

What Jev turned out to be good at, from production testing: wrong product scored 0.02, a detail that is not
in the photo 0.05, a half-finished headline 0.7 / 3.

## 4. AI reframe truthfulness (posts and stories)

Gemini 3 Pro Image recomposes the photo; the top 34% (post) / 30% (story) must stay empty for text and the
dish must not change. Gemini Flash compares original and reframe and writes a JSON report (same dish?,
added/removed food, top area clear?, generated text/logo?, people/hands?, defects). Jev reads the report:

| Question | Type | Reject if |
|---|---|---|
| `frame_truthful` | noul | < 0.5 |
| `frame_quality` | score 0-3 | < 1.5 |

Also rejected: generated text/logo, people or hands. Without Jev, Gemini's own `main_dish_same` and
`top_area_clear` flags decide. Rejected or failed -> the original photo is used (never a doubtful reframe).

## 5. Reel script (weekly reel)

Rules: exactly one slogan per shot, each <= `reel_line_max_words` (4) words / `reel_line_max_chars` (30)
characters, no dish name in a slogan, a closing question ending in "?" (<= 7 words, <= 40 characters),
caption 40-300 characters, no prohibited phrase, banned phrase or `#`. The short call to action is not
generated: it rotates through `reel_ctas`, because generated ones drifted into broken grammar.

| Key | Type | Asks | Weight | Gate |
|---|---|---|---|---|
| `grammar` | score 0-3 | language quality of the **worst single line** | 0.25 | < 1.5 |
| `appeal` | score 0-3 | appetizing, specific, varied slogans | 0.30 | - |
| `fit` | noul | every slogan fits its dish | 0.15 | < 0.4 |
| `cta` | score 0-3 | engaging closing question + call | 0.15 | - |
| `caption` | score 0-3 | caption quality | 0.15 | - |

The "weakest line" wording matters: asking for overall grammar averaged a single broken line away.
No candidate passes -> a safe fallback script from `reel_fallback` (product lines only + fixed closing card).

## 6. Reel opener clip (Veo)

Veo 3.1 Lite animates the opening frame (image-to-video, 8 s). Gemini Flash watches a small proxy of the
clip next to the source frame and reports; Jev decides:

| Question | Type | Reject if |
|---|---|---|
| `truthful` | noul | < 0.5 |
| `quality` | score 0-3 | < 1.5 |

Also rejected: people, hands or text. Without Jev: Gemini's `same_dish_throughout`, `morphing_or_melting`,
`flicker_or_glitches`. Rejected, failed or not finished after three polls -> the opener becomes a slow
sub-pixel zoom on the real frame.

## 7. Opening dish

Jev `choice` question: which dish looks most appetizing as a slow cinematic push-in with steam and sizzle.
Without Jev: the first dish matching `hero_keywords`, else the first frame.
