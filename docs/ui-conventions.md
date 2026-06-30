# UI conventions

Rules the proxsyno React frontend (`app/web/src/`) follows so the surface stays
coherent across pages. New components/pages must comply; reviewers flag deviations.
Adapted from the house style shared with sibling projects.

## Palette — dark zinc, single orange accent

Two-deep surface, dark-first:

- **Body**: `bg-zinc-950`. **Cards**: `bg-zinc-900`. **Inputs/wells**: `bg-zinc-950`.
- Text: `text-zinc-100` primary, `text-zinc-400` secondary, `text-zinc-500` labels.
- **Orange-400/500 is the ONE interactive accent** — active nav item, focus rings,
  selected tabs, drag handles, the "live/focused thing." Nothing else introduces a
  new accent.
- **Semantic colors, used only for meaning:** `emerald-500` = positive (running
  guest, healthy SMART, success), `rose-500` = danger/failure, `amber-300` = warn.
  **Green is never an interactive affordance** — only positive value semantics, so
  "is this clickable or did it succeed?" never arises.

## Card chrome — no double borders

`bg-zinc-900` on `bg-zinc-950` reads as a card edge on its own. **Do not add
`border border-zinc-800` to a top-level card** — it creates a visible double
outline next to any other framing.

- Top-level cards: `bg-zinc-900`, **no border**.
- KEEP borders on: header dividers inside a card (`border-b border-zinc-800`),
  inputs (their own affordance), and same-bg chips that would otherwise vanish.
- Quick grep: `bg-zinc-900 border border-zinc-800` on a top-level container almost
  always wants the border removed.

### Edge-to-edge layout

Stack page sections flush with a 1px body-bg hairline between them:

- Page body wrapper: `flex flex-col gap-px` (not `space-y-4`). The `bg-zinc-950`
  shows through as a thin separator between `bg-zinc-900` cards.
- Card grids use `gap-px` too (hairline between columns and rows). Reserve
  `gap-2/3/4` for spacing *inside* a card (label↔input), never between cards.
- Tell you're not flush yet: `space-y-{2,3,4,6}` / `gap-{2,3,4,6}` on a div whose
  children are top-level cards.

## No native browser dialogs

`window.alert`, `window.confirm`, `window.prompt` are **banned** in `app/web/src/`.
They block the thread, render with OS chrome that clashes with the dark palette, and
can't be styled/validated. Use the app's `Modal` + `ConfirmDialog` components
(`app/web/src/components/`). Destructive actions (delete share/user/guest,
force-stop) confirm first, with `tone="danger"`.

```sh
rg 'window\.(confirm|alert|prompt)\b' app/web/src/   # must be zero
```

## Icons (required)

Section headers, page headings, and primary action buttons **must** carry an icon —
a bare label reads as unfinished and a leading glyph makes scanning fast. proxsyno
uses **`lucide-react`** (already a dependency; this is the one intentional deviation
from the inline-SVG house rule — keep using lucide for consistency here). Size ~14–16
in headers, 11–12 inline in dense rows; tint with the surrounding tone; mark
`aria-hidden` (the adjacent text is the label).

## Buttons

Three weights only:
- **Primary** — `emerald-500` bg, semibold: the main action of a panel/modal.
- **Secondary** — `zinc-800` bg: neutral actions (Cancel, close).
- **Danger** — `rose-500` bg: destructive ops; always confirm first.

## Fields & forms

- Labels: uppercase, `tracking-wide`, `text-zinc-500`, `text-[10px]`, above the input.
- Inputs: `bg-zinc-950 border border-zinc-800`, orange focus ring.
- Spacing: stick to Tailwind `2/3/4` stops (`gap-2`, `p-3`, `space-y-2`). No
  half-step spacing without a reason.

## Modals & overlays

- Modal sizes: `sm` (confirm/alert/single input), `md` (small forms — default),
  `lg` (detail panels), `xl` (side-by-side). Pick the smallest that fits.
- ESC and backdrop click close the modal. Confirm/alert focus their primary button
  (Enter fires); prompts focus+select the input.
- **Dropdowns/menus rendered inside a modal MUST be `position: fixed`** (measured
  from their trigger, `zIndex` above the modal) — never `absolute`, or the modal's
  `overflow-auto` clips them. Re-measure on resize + capture-phase scroll.
- **Floating overlays clamp to the viewport**: read `getBoundingClientRect()` in a
  `useLayoutEffect`, flip left/up if it would overflow, render `visibility:hidden`
  until clamped (no first-frame flicker), keep an 8px margin.

## Terminal (community-script console)

The xterm console uses a dark theme consistent with the palette (zinc background,
zinc-100 foreground, orange cursor). It is the one place raw output is shown
verbatim; frame it in a `bg-zinc-900` card with a header row (icon + title + Close).
