import fs from 'fs';
import path from 'path';

/**
 * Dark-mode text. gray-500 on a gray-800 card measures 3.04:1 (3.66:1 on the
 * gray-900 page), under the 4.5:1 minimum; gray-400 measures 5.78:1. It was
 * first fixed on the dashboard and goal cards only, and the same class stayed
 * in 165 places elsewhere (Transactions, Portfolio, Savings, Loans, Review…),
 * so this now covers every component and page.
 */
const SRC = path.join(__dirname, '..', '..');
const DIRS = ['components', 'app'];

function tsxUnder(dir: string): string[] {
    return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) return tsxUnder(rel);
        return e.name.endsWith('.tsx') ? [rel] : [];
    });
}

const files = DIRS.flatMap(tsxUnder);

describe.each(files)('%s', (rel) => {
    it('uses no dark:text-gray-500 (fails contrast on dark cards)', () => {
        const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
        const lines = src.split('\n')
            .map((l, i) => (/(^|[\s"'`])dark:text-gray-500\b/.test(l) ? i + 1 : 0))
            .filter(Boolean);
        expect(lines).toEqual([]);
    });
});
