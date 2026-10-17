import fs from 'fs';
import path from 'path';

/**
 * Guards the single-select button groups on the transaction forms.
 *
 * These grids of <button>s stand in for radios, so two things are easy to get
 * half-right and impossible to see in a type-check: a group that carries
 * role="group" but whose aria-labelledby points at nothing, and a group whose
 * buttons never report aria-pressed — which is how the Link-to-Loan group
 * shipped, named but with no selection state.
 */

const SRC = path.join(__dirname, '..', '..');
const FILES = [
  'app/transactions/add/page.tsx',
  'app/transactions/edit/[id]/page.tsx',
];

/** The slice of source belonging to one role="group" container. */
function groupBlocks(src: string): string[] {
  const lines = src.split('\n');
  const blocks: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('role="group"')) return;
    // the container's children run until the indentation returns to its level
    const indent = (line.match(/^(\s*)/) as RegExpMatchArray)[1].length;
    let end = i + 1;
    while (end < lines.length) {
      const l = lines[end];
      const li = (l.match(/^(\s*)/) as RegExpMatchArray)[1].length;
      if (l.trim() && li <= indent && /^\s*<\//.test(l)) break;
      end++;
    }
    blocks.push(lines.slice(i, end).join('\n'));
  });
  return blocks;
}

describe.each(FILES)('button groups in %s', (rel) => {
  const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const ids = new Set([...src.matchAll(/\bid="([^"{]+)"/g)].map((m) => m[1]));

  it('declares at least one group', () => {
    expect(groupBlocks(src).length).toBeGreaterThan(0);
  });

  it('every aria-labelledby resolves to an id in the same file', () => {
    const dangling = [...src.matchAll(/aria-labelledby="([^"{]+)"/g)]
      .map((m) => m[1])
      .filter((ref) => !ids.has(ref));
    expect(dangling).toEqual([]);
  });

  it('every group names itself', () => {
    // the opening tag can span several lines, so read up to the first '>'
    const unnamed = groupBlocks(src).filter(
      (b) => !/aria-labelledby=/.test(b.slice(0, b.indexOf('>') + 1))
    );
    expect(unnamed).toEqual([]);
  });

  it('every option button reports whether it is chosen', () => {
    // Count rather than test for presence: one aria-pressed anywhere in the
    // block would otherwise satisfy a group whose other buttons have none,
    // which is the half-done state this file exists to catch.
    const mismatched = groupBlocks(src)
      .map((b) => ({
        buttons: (b.match(/<button\b/g) || []).length,
        pressed: (b.match(/aria-pressed=/g) || []).length,
        head: b.split('\n').slice(0, 3).join(' ').trim().slice(0, 70),
      }))
      .filter((g) => g.buttons > 0 && g.buttons !== g.pressed);
    expect(mismatched).toEqual([]);
  });
});
