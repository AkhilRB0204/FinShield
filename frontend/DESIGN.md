# FinShield design system

Tokens live in [`src/styles/tokens.css`](src/styles/tokens.css). Use them. Do not add new
colors, radii, shadows or animations without changing this document first.

## The organizing idea

Other fraud products show an opaque probability: a number with nothing behind it. FinShield
shows a score that **decomposes**. Every point in a FinShield risk score comes from a named
indicator with a written reason, and the interface exists to make that visible.

So the signature element is the **score bar** on the transaction detail page: one horizontal
stacked bar with one segment per triggered indicator, each segment as wide as that indicator's
points, and the review threshold marked on the track. It is the only element that is allowed to
be loud. Everything else stays quiet so the bar can carry the page.

## Color

**Warm is risk, cool is interface.** Warm colors appear only to communicate severity. If
something is warm and is not saying "this is how risky it is", it is a bug.

| Token             | Value     | Role                                                    | On paper |
| ----------------- | --------- | ------------------------------------------------------- | -------- |
| `--paper`         | `#f7f7f5` | Page background                                         | n/a      |
| `--ink`           | `#141a22` | Primary text, threshold mark                            | 16.3:1   |
| `--slate`         | `#5a6472` | Secondary text, axes, control borders                   | 5.6:1    |
| `--rule`          | `#dcddd8` | Hairlines, score bar track, skeleton fills              | 1.3:1    |
| `--accent`        | `#13585c` | Links, focus ring, selected state, primary action       | 7.6:1    |
| `--risk-critical` | `#a62d16` | Critical severity                                       | 6.5:1    |
| `--risk-high`     | `#c2721a` | High severity                                           | 3.4:1    |
| `--risk-medium`   | `#9a8b2e` | Medium severity                                         | 3.2:1    |

**Low risk has no color at all.** There is no `--risk-low` token and there must never be one.
A low-risk transaction is the normal case and looks like ordinary ink on paper. Above all, it
is not green: see the traffic light in the "do not build" list.

Rules that follow from the contrast figures:

- `--risk-high` and `--risk-medium` pass 3:1 for graphics but fail 4.5:1 for text. Use them only
  as **fills and marks**: score bar segments and the small level swatch next to a level name.
  Never set text in them.
- They pass 3:1 **only against paper**. Against `--rule` they fall to 2.7:1 and 2.5:1, so never
  place a risk fill on a `--rule` surface. This is why the score bar track is paper.
- A risk level is always **written out in ink** ("High", "Critical") next to its swatch. Color is
  never the only carrier of severity.
- `--rule` is too faint to bound a control. Inputs and buttons use `--slate` borders. `--rule`
  is for dividers, the bar track and skeletons only.
- `--accent` is the only cool color with a job. It never fills a risk element.

## Type

Two families, split by purpose: **serif for language, sans for data.**

- **Newsreader** (`--font-serif`) for the score numeral, headings, and the generated
  explanation: anything that is read as sentences or as the headline number.
- **Archivo** (`--font-sans`) for tables, labels, controls and chart axes: anything that is
  scanned, compared or operated.

### Fonts

Both families are self-hosted from npm, never loaded from Google Fonts or another CDN. That way
the app makes no third-party requests that would expose analysts' IP addresses, and the content
security policy can keep `font-src 'self'`. Install `@fontsource-variable/newsreader` and
`@fontsource-variable/archivo` and import both in the app entry point before `tokens.css`. The
family tokens name the variable families first and fall back to system fonts.

**Tabular figures everywhere.** `font-variant-numeric: tabular-nums` is set on `html`, so
amounts, scores and timestamps line up in columns and do not shift width as they change.

| Token          | Size | Use                                  |
| -------------- | ---- | ------------------------------------ |
| `--text-score` | 72px | The score numeral (serif)            |
| `--text-h1`    | 30px | Page title (serif)                   |
| `--text-h2`    | 22px | Band heading (serif)                 |
| `--text-prose` | 18px | Generated explanation (serif)        |
| `--text-base`  | 15px | Controls, body data (sans)           |
| `--text-sm`    | 13px | Labels, table cells (sans)           |
| `--text-xs`    | 12px | Axis ticks (sans)                    |

Labels are sentence case ("Risk score", "Flagged for review"), never all caps.

Scores and points are displayed to one decimal place. The client never computes anything from
a displayed figure: whether a transaction is flagged comes from the API's `flagged_for_review`
field, because a score of 29.96 displays as "30.0" but is below the threshold. Never smooth,
bucket or estimate a number the engine computed exactly.

## Layout

- A **fixed 220px left rail** (`--rail-width`) holds navigation. Main content fills the rest.
- Main content is a vertical stack of **bands** divided by hairlines (`--hairline`), not cards.
  A band is full width, with `--band-padding-block` and `--band-padding-inline`.
- **Prose is capped at 68ch** (`--measure`). This covers the generated explanation and any
  other running text. Tables and the score bar may be wider.
- **Everything is left-aligned**, including headings, the score numeral, empty states and
  numeric table columns. Tabular figures keep same-length numbers aligned.
- **One border radius, 3px** (`--radius-control`), and only on interactive controls: buttons,
  inputs, selects. Bands, tables, the score bar and badges are square.
- **Hairlines instead of shadows.** Nothing in the app has a `box-shadow`. Separation comes
  from a 1px `--rule` line or from space.

## The score bar

This is the one element that gets visual weight. Build it exactly as follows.

- **Track.** A `--score-bar-track` (paper) bar with a `--score-bar-track-border` hairline
  outline, spanning the 0 to `breakdown.max_score` scale, `--score-bar-height` tall and
  square-cornered. Do not fill the track with `--rule` (see Color).
- **Segments.** One segment per triggered indicator, in the order the API returns them (most
  points first). Each segment's width is proportional to its points. Segments are separated by a
  `--score-bar-gap` of paper.
- **Segment color.** Every segment takes the color of the transaction's overall risk level
  (`--risk-critical`, `--risk-high` or `--risk-medium`). A low-risk transaction's segments are
  `--score-bar-low` (slate), because low risk has no color.
- **Threshold.** A 1px `--score-bar-threshold-mark` vertical line at
  `breakdown.review_threshold`, extending above and below the track, labelled "Review threshold"
  with its value in sans `--text-xs`. Never hard-code the threshold in the client.
- **Labels.** Each segment is labelled directly beneath the bar with the indicator's human name
  and its points to one decimal place ("Geographic anomaly 35.0"). No legend and no hover-only information.
  When a segment is too narrow for its label, list it below with a leader line; never truncate
  the number.
- **Honest totals.** The bar must add up to the score the engine reported. Every figure needed
  comes from the API's `breakdown` object; the client never recomputes the multiplier, the cap
  or the threshold. Two cases need care:
  - When `breakdown.compound_bonus` is above 0, show it as its own final segment labelled
    "Compound bonus", with its points.
  - When `breakdown.capped` is true, scale every segment (including the bonus) by
    `max_score / uncapped_score` so the bar ends exactly at `max_score`. Keep each label at its
    true unscaled points, and add a note in sans: "Capped at 100 from 112.4", using
    `uncapped_score`.
- **The numeral.** The score sits above the bar in Newsreader at `--text-score`, with the level
  name and swatch beside it in sans.
- **Accessibility.** The bar has a text equivalent: the same indicators and points in a visually
  hidden list, so the decomposition is available without seeing the bar.

## Motion

**There is one motion moment in the whole app:** the score bar segments grow from zero when the
bar mounts. Each takes 400ms (`--score-bar-duration`), and they start 60ms apart
(`--score-bar-stagger`), left to right. Give each segment the `.score-segment` class and set
`--segment-index` on it inline.

Under `prefers-reduced-motion: reduce`, the duration and stagger are 0ms and the animation is
removed, so the bar appears at full width immediately. `tokens.css` handles this; components
must not reintroduce motion.

Nothing else moves. Hover and focus changes are immediate. Skeletons are static. Rows do not
slide, panels do not fade, numbers do not count up.

## Language

The rules in the repository's `CLAUDE.md` apply to every string in the client:

- Never show a snake_case identifier. The API returns human labels for indicators and
  categories ("Micro amount", "Gift cards"); render those, and never fall back to a raw key.
  `risk_level` arrives as a lowercase value (`"critical"`); map it to its label ("Critical")
  through a fixed lookup.
- Never state that a transaction is fraud. Say "high risk", "flagged for review", "consistent
  with card-testing patterns".

## Rendering untrusted text

The generated explanation is model output, and merchant names, cities and indicator details
come from transaction data. Treat all of it as untrusted:

- Render it as text only, never as HTML. No `innerHTML`, no `dangerouslySetInnerHTML`, no
  `v-html`, and no Markdown rendering of the explanation.
- Never build a URL, a CSS value or a class name from API text.
- Read the API base URL from build-time configuration, not from the page URL or user input.

## Do not build

These are the defaults that make a dashboard look like every other dashboard. Each one is
banned.

- **Identical rounded cards with soft grey shadows.** Use hairline-divided bands. Radius is for
  controls only, and nothing has a shadow.
- **ALL-CAPS label text.** Labels are sentence case. No `text-transform: uppercase`, no
  letter-spaced small caps used as decoration.
- **Gradient decoration.** No gradients anywhere: not on backgrounds, buttons, bars or text.
  Every fill is a flat token color.
- **Metadata joined by middle dots.** Not "Seattle, WA · $213.77 · 01:53". Give each value its
  own labelled field or table column.
- **Arrows appended to buttons.** A button says what it does ("Open transaction"), with no
  "→", "›" or chevron tacked on.
- **A green, yellow and red traffic light.** Severity runs from no color (low) through medium,
  high and critical. Nothing is green, and low risk is not "safe".
- **Spinners instead of skeletons.** Loading states are static skeletons in `--rule` at the shape
  of the content that is coming. No spinners and no shimmer, since the score bar is the only
  thing that moves.
