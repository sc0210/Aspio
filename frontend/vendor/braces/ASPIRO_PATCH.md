# braces 3.0.3 + nesting-depth limit

Upstream `braces` 3.0.3 (the latest release) is affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): a pattern
with a few thousand nested `{` overflows the call stack. Upstream has no fix yet,
and Tailwind 3, micromatch and `@next/eslint-plugin-next` all still require it.

This copy is the published 3.0.3 tarball, versioned `3.0.4-aspiro.0` so `npm audit`
no longer matches it, with one change: `lib/parse.js` throws a
`SyntaxError` once nesting passes `MAX_DEPTH` (256, `lib/constants.js`). The
`package.json` was trimmed to the fields npm needs to install it.
`frontend/package.json` installs it as a devDependency and points every other
`braces` at it through `overrides` (`"braces": "$braces"`; a relative `file:` path
inside `overrides` would resolve against each dependent package instead).

Delete this folder and the override once npm has a fixed `braces` release.
