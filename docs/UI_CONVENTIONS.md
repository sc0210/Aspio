# UI Conventions

Styling, responsive and accessibility rules for the frontend. These are conventions the codebase
already follows — match them rather than inventing a parallel system.

## Colour

Defined in `frontend/tailwind.config.js`. Dark mode is class-based (`darkMode: 'class'`), driven
by `ThemeContext`.

| Scale | Role | 500 / 600 |
|---|---|---|
| `prosperity-*` | **Primary brand palette** | `#10b981` / `#059669` |
| `primary-*` / `trust-*` | Blue accent | `#0ea5e9` / `#0284c7` |
| `success-*` | Positive | `#22c55e` / `#16a34a` |
| `error-*` | Negative | red scale |
| `warning-*` / `gold-*` | Caution, highlights | `#f59e0b` / `#d97706` |
| `secondary-*` | Neutral slate | `#64748b` / `#475569` |
| `auspicious` | `red` `#dc2626` · `gold` `#f59e0b` · `jade` `#10b981` | market-convention accents |

`income` and `expense` are aliases of `success` and `error` — the config shares one `successScale`
/ `errorScale` object precisely so the semantic names cannot drift from the base palettes. Use
`income`/`expense` when the meaning is financial direction, `success`/`error` when it is UI state.

Taiwan/Asia market convention inverts the Western red/green mapping for price movement. Where a
chart or ticker shows market direction, honour the local convention rather than assuming
green-up.

## Typography

The font stack does language switching by itself: Inter carries no CJK glyphs, so Latin resolves
to Inter and Chinese falls through to Noto Sans TC per glyph. No language-conditional class is
needed anywhere.

Both faces are self-hosted — Inter via `next/font/local` in `app/layout.tsx`, Noto via
`src/styles/noto-sans-tc.css`. Neither is named bare in the stack: a bare `'Inter'` would let a
random system copy beat the subsetted file we ship. Generic families sit at the end exactly
once; putting one inside Inter's own fallback list terminates the cascade before Noto is ever
consulted.

### Type scale

Use the Tailwind scale. `text-sm` and `text-xs` carry almost everything — they are the body and
caption of this app, not fallbacks.

| Role | Class | px |
|---|---|---|
| Page title | `text-2xl` | 24 |
| Section / panel heading | `text-lg` | 18 |
| Card title | `text-base` | 16 |
| Body, primary label, input label, hint | `text-sm` | 14 |
| Caption, footnote, chip, table header, uppercase label | `text-xs` | 12 |

Display figures (a hero KPI, a scorecard total) may go larger — `text-3xl` upward, or an
arbitrary size where a specific optical size is wanted.

**12px is the floor for anything a user reads as prose or as a label.** Below that, only three
things qualify, and they are deliberate:

- chart and heatmap internals — axis ticks, cell values, anything with `leading-none` inside a
  dense grid, where 12px would force the cell wider than the data
- the mobile tab bar (`MobileBottomNav`), which follows platform convention at 10px
- count badges that sit inside a fixed-size circle

Everything else uses the table above. In particular, do not reach for `text-[12px]` or
`text-[14px]`: they render identically to `text-xs` and `text-sm` and only hide the drift.

## Responsive

Stock Tailwind breakpoints, no custom `screens`:

| | `sm` | `md` | `lg` | `xl` | `2xl` |
|---|---|---|---|---|---|
| min-width | 640 | 768 | 1024 | 1280 | 1536 |

Mobile-first: write the phone layout as the base and add `md:`/`lg:` overrides upward.

For layout differences too large for CSS — a genuinely different component tree rather than a
reflow — switch on `useIsMobile()` from `@/hooks/useMediaQuery` (true below `md`, i.e. < 768px).

It returns `boolean | null`, and `null` means "not yet known": the hook is SSR-safe and stays
`null` until mounted so server and first client render agree. Treat `null` as a neutral state
and render something layout-stable — branching on it as if it were `false` produces a hydration
mismatch and a visible flash.

Phone screens follow a "one hero per page" direction: a single focused primary element rather
than a scaled-down desktop grid.

## Accessibility

- **`focus-visible:` not `focus:`** for keyboard-only affordances. Plain `focus:` fires on mouse
  click too, which flashes a ring on page load and on every click.
- Touch targets: 44×44px minimum, 48px for form inputs.
- Honour `prefers-reduced-motion` — `ThemeContext` already tracks it, along with
  `prefers-contrast: high`.
- Charts need a non-colour channel too (label, shape, or direct value); colour alone fails for
  the ~8% of men with red-green colour deficiency, which is exactly the axis financial UI leans on.

## Components

- **Images from external CDNs** (LINE profile pictures, etc.) use a plain `<img>`, not
  `next/image` — remote hosts are not in the image config. Add
  `// eslint-disable-next-line @next/next/no-img-element` where the rule complains.
- **LINE brand green**: `#06C755`, hover `#05b34d`. Use it only for LINE-specific affordances.
- Authenticated pages wrap in `DashboardLayout` from `components/layout/`.

### Surfaces — `Card`

Every white panel on a page is `Card` from `components/ui/Card.tsx`. It was written
out by hand 73 times in 42 spellings before that, and the differences were mostly
not decisions — `rounded-xl` beside `rounded-2xl` for the same kind of panel,
`border-gray-100` where everything else said `border-gray-200`.

```tsx
<Card>…</Card>                          // rounded-2xl, shadow-sm, p-4 sm:p-5
<Card padding="none" clip>…</Card>      // sections bring their own padding
<Card accent="rose">…</Card>            // with the hairline
```

| Prop | Values | Default |
|---|---|---|
| `padding` | `none` `sm` `md` `lg` `xl` | `md` (`p-4 sm:p-5`) |
| `radius` | `xl` `2xl` | `2xl` |
| `shadow` | `none` `sm` `lg` | `sm` |
| `accent` | a key of `ui/accent.ts` | none |
| `clip` | `boolean` — `overflow-hidden` | `true` when `accent` is set |
| `hover` | `boolean` — the lift used by link cards | `false` |

Anything genuinely one-off — a grid span, a fixed height, a non-grey border — goes
through `className`. `cn` is `twMerge`, so a caller's class beats the component's.

**`Card` is not for dialogs.** A modal surface is a different thing (`shadow-2xl`, its
own dark value, a max-width, an entrance animation) and belongs to `Modal`.

The accent palette lives in `components/ui/accent.ts` because both `Card` and
`PageHeader` draw the hairline. `src/__tests__/components/ui/Card.test.tsx` fails on
any hand-rolled card shell, so the 42 spellings cannot grow back.

### Page chrome — who names the page

A page is named in two places, and each owns exactly one breakpoint range:

| Width | Component | Looks like |
|---|---|---|
| ≥ `md` | `PageTitle`, inside `DashboardLayout`'s top bar | `Portfolio / Rebalancing`, `text-sm` |
| < `md` | `PageHeader`, rendered by the page itself | a card with an accent hairline, `h1` at `text-lg sm:text-xl` |

The two wrappers are exact complements — `hidden md:flex` and `md:hidden` — so
**exactly one `<h1>` renders at any width**. A page that draws its own heading
unconditionally breaks that: it says its name twice on desktop and emits a second
`h1`. Use `PageHeader`; do not hand-roll the card.

`PageTitle` reads top-level titles from `lib/navigation.ts`, so adding a page to the
sidebar gives it a title automatically. A page that is *not* a sidebar destination —
a child like `/transactions/add`, or one reached from inside another like
`/rebalancing` — needs an entry in that file's `SUBROUTES`, with `parentHref` for the
breadcrumb. `src/__tests__/layout/pageChrome.test.tsx` walks `app/` and fails on any
route that resolves no title, which is how `/housing` and `/lifecycle` shipping with an
empty top bar is prevented from recurring.

Two deliberate exceptions: `/portfolio/trend` uses a flush sticky app-bar rather than a
card, and `/transactions/scan` mounts no `DashboardLayout`, so its own heading is the
only name it has.
- `main` is the scroll container, not `body` — anything that measures or pins to scroll position
  must attach there.

## Previewing

Set the `demo-mode=true` cookie to view authenticated pages in a browser without logging in.
Use the cookie, not the demo login button — the button takes a different code path. Note that
demo fixtures hand back `Date` objects where the API returns strings, so code that assumes one
or the other will behave differently in demo than in production.
