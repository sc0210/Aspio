/**
 * Raw red and green may only shrink.
 *
 * Red and green in this app mean something, and the meaning picks the scale:
 *   - a market move (gain/loss, day change, return): `rise-*` / `fall-*`, which
 *     follow the gains-in-red setting;
 *   - money in or out: `income-*` / `expense-*`;
 *   - UI state (saved, failed, invalid): `success-*` / `error-*`.
 * A raw `text-green-700` says none of that, and is how the portfolio page came
 * to show gains in red while the dashboard showed them in green.
 *
 * There were 763 when this was written, too many to move in one change, so
 * this is a ratchet, and an exact one: removing some without lowering BASELINE
 * fails too, so the room freed cannot be spent by the next change.
 */
import fs from 'fs';
import path from 'path';

const BASELINE = 759;
const RAW = /\b(?:text|bg|border|from|to|via|ring|fill|stroke|divide|outline|placeholder|shadow|accent|decoration)-(?:green|red|emerald|rose)-\d{2,3}\b/g;
const SRC = path.join(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

it('adds no raw red/green classes (use rise/fall, income/expense or success/error)', () => {
  const files = ['app', 'components', 'lib', 'hooks', 'contexts', 'utils'].flatMap((d) => walk(path.join(SRC, d)));
  const count = files.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(RAW)?.length ?? 0), 0);
  expect(files.length).toBeGreaterThan(100);
  if (count < BASELINE) {
    throw new Error(`Raw red/green classes fell to ${count}. Lower BASELINE in this file from ${BASELINE} to ${count}.`);
  }
  expect(count).toBeLessThanOrEqual(BASELINE);
});
