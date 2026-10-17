# Self-hosted fonts

## Why these are committed

`inter-latin-variable.woff2` is vendored rather than fetched by
`next/font/google`. That loader downloads the font from Google **at build time**,
which made every production build depend on `fonts.gstatic.com` being reachable.
On 2026-08-14 it wasn't, and CI failed with:

```
NextFontError: Failed to fetch `Inter` from Google Fonts
```

Because the Pi deploy is gated on CI, a transient Google Fonts blip blocked
deploys entirely. Vendoring removes an external dependency from the build.

## What this file is

The **latin** subset of Inter v20, exactly the subset the previous
`Inter({ subsets: ['latin'] })` config resolved to — pulled from the URL in
Google's own CSS response, so the bytes are the same ones that were being served.

It is a **variable** font (`font-weight: 400 700`), so this single 48 KB file
covers the four static weights the old config requested (400/500/600/700). No
other subset is included, matching the previous behaviour.

## Updating it

Only needed to pick up a new Inter release. Refetch the latin block:

```bash
curl -H "User-Agent: Mozilla/5.0" \
  "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap"
```

Take the `src:` URL from the block commented `/* latin */` (the one whose
`unicode-range` starts `U+0000-00FF`) and save it over this file. Confirm it
still reports `font-weight: 400 700`; if Google switches back to static weights,
`next/font/local` needs one `src` entry per weight instead.

## The other half: Traditional Chinese

Inter has no CJK coverage, so Chinese comes from **Noto Sans TC**, also
self-hosted — but it lives elsewhere and works differently:

| | Inter | Noto Sans TC |
|---|---|---|
| Files | `./inter-latin-variable.woff2` (48 KB) | `public/fonts/noto-sans-tc/` (105 chunks, ~4 MB) |
| Loaded by | `next/font/local` in `app/layout.tsx` | `src/styles/noto-sans-tc.css` |
| Refresh | by hand, see above | `node scripts/build-noto-css.mjs` |

Noto needs hand-written `@font-face` rules because the family ships as ~105
unicode-range chunks, and `next/font/local` treats each `src` entry as a *weight*
variant with no way to express `unicode-range`. Keeping the split matters: a
single combined face would push ~4 MB at every visitor, whereas split ranges mean
a page downloads only the chunks whose glyphs it renders — and nothing at all if
no CJK appears.

The two compose in Tailwind's `sans` stack as
`var(--font-inter), var(--font-noto-tc), system-ui, …`, so the browser picks per
glyph. Two rules keep that working, and both are easy to undo by accident:

- **Inter must not declare a `fallback`.** `next/font` inlines that list into the
  variable's value, so a generic inside it ends the cascade within
  `var(--font-inter)` — before Noto is ever consulted. The generics belong at the
  end of the Tailwind stack, once.
- **The body uses `inter.variable`, not `inter.className`.** `className` pins the
  element to Inter alone, which would leave CJK to the generic.

## Licence

Inter is licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`, which
must stay alongside the font file. Noto Sans TC is also SIL OFL 1.1; its licence
sits with its files in `public/fonts/noto-sans-tc/LICENSE.txt`. The OFL permits
redistribution (including bundled in an application) provided the licence travels
with it.
