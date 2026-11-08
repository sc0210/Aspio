import fs from 'fs';
import path from 'path';

/**
 * A white-text button must not switch to a 500-shade background in dark mode:
 * white on primary-500 measured 2.77:1, on green-500 2.27:1, on error-500
 * 3.76:1, all under 4.5:1. The 700 shades read well on a dark page.
 */
const SRC = path.join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

const offending = /(?=[^'"`]*\btext-white\b)[^'"`]*\bdark:bg-(primary|prosperity|green|success|warning|error)-500\b[^'"`]*/;

it('no white-text class list puts it on a 500 background in dark mode', () => {
  const hits = sources('components').concat(sources('app')).flatMap((rel) =>
    fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
      .map((line, i) => (offending.test(line) ? `${rel}:${i + 1}` : ''))
      .filter(Boolean));
  expect(hits).toEqual([]);
});
