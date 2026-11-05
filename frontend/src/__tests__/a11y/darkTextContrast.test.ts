import fs from 'fs';
import path from 'path';

/**
 * Dark-mode body text on the dashboard and goal cards. gray-500 on a gray-800 card measures
 * 3.04:1, under the 4.5:1 minimum, and it was the default label colour in 63
 * places across these components. gray-400 measures 5.78:1.
 */
const SRC = path.join(__dirname, '..', '..');
const DIRS = ['components/dashboard', 'components/goals'];

const files = DIRS.flatMap((dir) =>
    fs.readdirSync(path.join(SRC, dir))
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => path.join(dir, f)),
);

describe.each(files)('%s', (rel) => {
    it('uses no dark:text-gray-500 (fails contrast on dark cards)', () => {
        const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
        const lines = src.split('\n')
            .map((l, i) => (/(^|[\s"'`])dark:text-gray-500\b/.test(l) ? i + 1 : 0))
            .filter(Boolean);
        expect(lines).toEqual([]);
    });
});
