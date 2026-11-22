# Design system — "Court"

The web app's visual language. Tokens live in `apps/web/src/app/globals.css`, Tailwind
maps them in `apps/web/tailwind.config.ts`, and the primitives are in
`apps/web/src/components/ui.tsx`. Use the primitives; reach for raw classes only for
layout.

## Principles

Taken from the systems the product is measured against — Linear's redesign (less
visual noise, tighter alignment, clearer hierarchy), Vercel's Geist (each colour step has
one job), and the way fitness products such as WHOOP and Strava present a headline score.

- **One hero per screen.** The dashboard leads with win rate and form, and rating on the
  one dark card; supporting numbers sit in a quieter strip. Never eight equal tiles.
- **Neutrals do the work.** A cool grey ramp carries almost everything. Colour means
  something: volt is the primary action and the active state, green and red are results.
- **Numbers are the content.** Geist, tight tracking at display sizes, tabular figures
  wherever numbers line up. Scores use Geist Mono.
- **Colour is never the only signal.** Every win/loss carries a letter or a sign.
- **Both themes are designed**, not inverted. Dark mode shows elevation by lightness.

## Colour

| Token                                               | Job                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `surface-sunken` / `DEFAULT` / `raised` / `overlay` | canvas → chrome → cards → floating                         |
| `ink` / `ink-secondary` / `ink-muted`               | primary text → supporting text → labels and hints          |
| `line` / `line-strong`                              | borders; strong for hover                                  |
| `accent` (volt `#cdf24b`)                           | fills only — primary buttons, the active marker, rings     |
| `accent-text`                                       | volt as text or a link; darker in light mode for contrast  |
| `win` / `loss` / `warn` (+ `-soft`)                 | result meaning only; soft tints for badges and backgrounds |
| `series-1..3`, `diverge-*`, `seq-*`                 | charts; never reused for UI chrome                         |

Volt is too light to be text on white. Text and chart strokes use `accent-text` /
`series-1`, which are darker steps of the same hue in light mode.

## Type

Geist Sans and Geist Mono, from the `geist` package (local files, no network at build).
Display sizes: `text-display` (rating), `text-hero` (headline record), `text-stat`
(KPI tiles). Small uppercase labels use the `.eyebrow` class.

## Components

`Button` / `buttonClass` (primary · secondary · ghost · danger), `Input`, `Select` /
`selectClasses`, `Segmented` (period pickers and two-way switches), `Card` /
`CardHeader`, `Stat`, `Delta`, `Badge`, `ResultBadge`, `FormStrip`, `Ring`, `Meter`,
`Avatar` (a tint chosen from the name, so a person keeps their colour everywhere),
`EmptyState`, `Skeleton`, `Kbd`.

## Navigation

A grouped sidebar (Play · Analyse · Manage) with the Record action pinned at the top,
content on an inset panel. `⌘K` (or `/`) opens the command palette; single keys jump
between pages (`R` record, `D` dashboard, `M` matches, `A` analytics, `O` opponents,
`G` goals, `C` calendar, `P` players, `,` settings). On phones, a five-tab bar with
Record raised in the middle.
