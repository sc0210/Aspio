import fs from 'fs';
import path from 'path';

/**
 * A white-text button must not switch to a 500-shade background in dark mode:
 * white on primary-500 measured 2.77:1, on green-500 2.27:1, on error-500
 * 3.76:1, all under 4.5:1. The 700 shades read well on a dark page.
 *
 * Checks each whole string or template literal (a class list wrapped over
 * several lines is still one), and leaves opacity variants such as
 * `dark:bg-primary-500/20` alone: a tint behind white text isn't this case.
 */
const SRC = path.join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

const LITERAL = /(['"`])((?:(?!\1)[\s\S])*?)\1/g;
const WHITE = /(^|\s)text-white(?![\w/-])/;
const DARK_500 = /(^|\s)dark:bg-(primary|prosperity|green|success|warning|error)-500(?![\w/-])/;

export function offendingLiterals(source: string): string[] {
  return [...source.matchAll(LITERAL)].map((m) => m[2]).filter((s) => WHITE.test(s) && DARK_500.test(s));
}

it('catches a class list wrapped over lines, and not an opacity tint', () => {
  expect(offendingLiterals("cn('px-3 text-white\n  dark:bg-primary-500')")).toHaveLength(1);
  expect(offendingLiterals("'text-white dark:bg-primary-500/20'")).toHaveLength(0);
  expect(offendingLiterals("'text-white dark:bg-primary-700'")).toHaveLength(0);
});

it('no white-text class list puts it on a 500 background in dark mode', () => {
  const hits = sources('components').concat(sources('app')).flatMap((rel) =>
    offendingLiterals(fs.readFileSync(path.join(SRC, rel), 'utf8')).map((s) => `${rel}: ${s.slice(0, 80)}`));
  expect(hits).toEqual([]);
});
