#!/usr/bin/env node
/**
 * Regenerate the self-hosted Noto Sans TC subset files and their @font-face CSS.
 *
 * Run only to pick up a new Noto release — the output is committed, and nothing
 * in the build or the running app calls this. Keeping the fetch here rather than
 * in the build is the entire point: a production build that reaches out to
 * fonts.gstatic.com fails whenever Google is unreachable, which is what broke
 * CI (and therefore the Pi deploy) on 2026-08-14.
 *
 *   node scripts/build-noto-css.mjs
 *
 * Writes:
 *   public/fonts/noto-sans-tc/noto-sans-tc-NNN.woff2   (~105 files, ~4MB)
 *   src/styles/noto-sans-tc.css
 *
 * The range split is Google's own. It matters: one combined face would be ~4MB
 * for every visitor, whereas split ranges mean a page downloads only the chunks
 * whose glyphs it actually renders.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'public/fonts/noto-sans-tc');
const CSS_PATH = join(ROOT, 'src/styles/noto-sans-tc.css');

// A modern UA is required — Google serves TTF to anything it doesn't recognise.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SOURCE =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400..700&display=swap';

const css = await (await fetch(SOURCE, { headers: { 'User-Agent': UA } })).text();

const faces = [...css.matchAll(/@font-face\s*\{(.*?)\}/gs)]
  .map(([, body]) => ({
    url: body.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1],
    range: body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim(),
  }))
  .filter((f) => f.url && f.range);

if (faces.length === 0) throw new Error('No @font-face blocks parsed — did the CSS format change?');

await mkdir(FONT_DIR, { recursive: true });

const rules = [];
let bytes = 0;
for (const [i, face] of faces.entries()) {
  const name = `noto-sans-tc-${String(i).padStart(3, '0')}.woff2`;
  const data = Buffer.from(await (await fetch(face.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  await writeFile(join(FONT_DIR, name), data);
  bytes += data.length;
  rules.push(
    `@font-face {\n` +
      `  font-family: 'Noto Sans TC';\n` +
      `  font-style: normal;\n` +
      `  font-weight: 400 700;\n` +
      `  font-display: swap;\n` +
      `  src: url('/fonts/noto-sans-tc/${name}') format('woff2');\n` +
      `  unicode-range: ${face.range};\n` +
      `}`,
  );
}

const header = `/*
 * Noto Sans TC — self-hosted, unicode-range split.
 *
 * Generated from Google's own CSS for \`Noto+Sans+TC:wght@400..700\`, so these
 * are the same bytes and the same range boundaries next/font/google would have
 * fetched — served from our origin instead of fonts.gstatic.com.
 *
 * Hand-written @font-face rather than next/font/local because this family ships
 * as ${faces.length} range-split chunks, and next/font/local treats each \`src\` entry as
 * a WEIGHT variant with no way to express unicode-range. One variable face
 * covers 400-700, so weight changes cost no extra download.
 *
 * DO NOT EDIT BY HAND — regenerate with scripts/build-noto-css.mjs.
 */

/* Exposed as a variable so the Tailwind \`sans\` stack composes it the same way
 * it composes Inter's next/font variable, rather than naming the family
 * directly in the config. */
:root {
  --font-noto-tc: 'Noto Sans TC';
}
`;

await writeFile(CSS_PATH, `${header}\n${rules.join('\n\n')}\n`);
console.log(`Wrote ${faces.length} faces, ${(bytes / 1024 / 1024).toFixed(2)} MB → ${FONT_DIR}`);
