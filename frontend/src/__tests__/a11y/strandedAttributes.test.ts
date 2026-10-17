import fs from 'fs';
import path from 'path';

/**
 * Catches JSX attributes written after their tag already closed.
 *
 * This shipped on /portfolio/add: aria-invalid and aria-describedby were added
 * on the line *after* a single-line `<select ... >`, so React rendered them as
 * text children. <select> paints nothing but <option>s, the file type-checked
 * and linted clean, and the DOM node simply never got the attributes — the fix
 * was silently doing nothing for exactly the fields it targeted.
 *
 * The detector is a pure function so both outcomes can be pinned with synthetic
 * input; the repo-wide scan below then applies it to every file.
 */

const SRC = path.join(__dirname, '..', '..');

// a line that is nothing but `someAttr={...}` / `someAttr="..."`
const ATTR_ONLY = /^\s*([a-zA-Z_][\w:-]*)=(?:\{.*\}|".*"|'.*')\s*$/;
// the attributes most likely to be moved around by an automated pass
const RISKY = /^(aria-[\w-]+|role|id|htmlFor|inputMode|tabIndex|onWheel)$/;

/** True when `line` closes a JSX tag (ends with `>` but is not an arrow function). */
function closesTag(line: string): boolean {
  const t = line.trimEnd();
  return t.endsWith('>') && !t.endsWith('=>');
}

/**
 * Zero-based indices of lines holding a risky attribute that sits outside its
 * opening tag. Exported shape kept simple so the cases below can pin it.
 */
export function findStranded(lines: string[]): number[] {
  const hits: number[] = [];
  lines.forEach((line, i) => {
    const m = ATTR_ONLY.exec(line);
    if (!m || !RISKY.test(m[1])) return;
    // Walk back to the real preceding tag line. Skipping other attribute-shaped
    // lines matters: a run of stranded attributes led by a non-risky one (say
    // data-testid) would otherwise hide every risky line behind it.
    let p = i - 1;
    while (
      p >= 0 &&
      (!lines[p].trim() ||
        /^\s*(\/\/|\/\*|\*)/.test(lines[p]) ||
        ATTR_ONLY.test(lines[p]))
    )
      p--;
    if (p >= 0 && closesTag(lines[p])) hits.push(i);
  });
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('findStranded', () => {
  it('flags an attribute after a single-line tag — the /portfolio/add bug', () => {
    const lines = [
      '  <select id="type" {...register(\'type\')} className="input text-sm">',
      '    aria-invalid={!!errors.type}',
      '    <option value="stock">Stock</option>',
      '  </select>',
    ];
    expect(findStranded(lines)).toEqual([1]);
  });

  it('flags a risky attribute hidden behind a non-risky one', () => {
    const lines = [
      '  <select id="type" className="input">',
      '    data-testid="type-select"',
      '    aria-invalid={!!errors.type}',
      '  </select>',
    ];
    // the data-testid line is not risky itself; the aria-invalid behind it still counts
    expect(findStranded(lines)).toEqual([2]);
  });

  it('leaves a legitimate multi-line opening tag alone', () => {
    const lines = [
      '  <input',
      '    id="amount"',
      '    aria-label="Amount"',
      '    aria-invalid={!!errors.amount}',
      '    className="input"',
      '  />',
    ];
    expect(findStranded(lines)).toEqual([]);
  });

  it('does not mistake an arrow function body for a closed tag', () => {
    const lines = [
      '  onChange={(e) =>',
      '    aria-label="not really an attribute here"',
    ];
    expect(findStranded(lines)).toEqual([]);
  });

  it('ignores attributes that are not identity or a11y related', () => {
    const lines = ['  <div className="x">', '    placeholder="just text"'];
    expect(findStranded(lines)).toEqual([]);
  });
});

describe('JSX attributes are inside their opening tag', () => {
  const files = walk(path.join(SRC, 'app')).concat(walk(path.join(SRC, 'components')));

  it('no risky attribute is stranded as a child node', () => {
    const stranded: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const i of findStranded(lines)) {
        stranded.push(`${path.relative(SRC, file)}:${i + 1}  ${lines[i].trim().slice(0, 60)}`);
      }
    }
    expect(stranded).toEqual([]);
  });
});
