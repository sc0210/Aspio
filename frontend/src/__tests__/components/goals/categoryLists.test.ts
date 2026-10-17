/**
 * The two lists of goal categories have to name the same set.
 *
 * `GOAL_CATEGORIES` supplies the icon and colour a card draws with; the
 * `CATEGORY_KEYS` arrays supply what a reader can actually pick. They had
 * drifted in both directions at once: `car_purchase` had an icon but appeared
 * in no dropdown, so a goal already filed under it could not be re-selected in
 * Edit; `savings` could be chosen but drew the fallback 🎯 because the icon list
 * had never heard of it.
 *
 * Read from source rather than imported, because the arrays are module-private
 * — the same trick keyResolution uses for keys built inside template literals.
 */

import fs from 'fs';
import path from 'path';
import { GOAL_CATEGORIES } from '@/utils/constants';

const SRC = path.join(__dirname, '../../..');

const readArray = (file: string, name: string): string[] => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const literal = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1];
    expect(literal).toBeDefined();
    return [...literal!.matchAll(/'([\w-]+)'/g)].map((match) => match[1]);
};

const CATEGORY_ARRAYS: [file: string, array: string][] = [
    ['components/goals/CreateGoalModal.tsx', 'CATEGORY_KEYS'],
    ['components/goals/EditGoalModal.tsx', 'CATEGORY_KEYS'],
    ['app/goals/page.tsx', 'CATEGORY_FILTER_KEYS'],
];

describe('goal categories', () => {
    const known = GOAL_CATEGORIES.map((category) => category.id).sort();

    it.each(CATEGORY_ARRAYS)('%s > %s offers exactly the categories that exist', (file, array) => {
        expect(readArray(file, array).sort()).toEqual(known);
    });

    it('gives every category its own id', () => {
        expect(new Set(known).size).toBe(known.length);
    });
});
