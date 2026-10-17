/**
 * Every stage and milestone id has copy behind it, in both languages.
 *
 * Translating by id is what stops a copy change from silently swapping one
 * stage's wording for its neighbour's — but it moves the failure somewhere
 * quieter: `t()` falls back to the English default when a key is missing, so a
 * mismatched id renders perfectly readable English on a Chinese page and
 * nothing anywhere complains. That is exactly what happened to `growing`,
 * whose copy was filed under `growth` because the label said "Growth Phase".
 *
 * This compares the ids the code actually uses against the bundles.
 */

import { FINANCIAL_STAGES } from '@/hooks/useRetirementProjection';
import en from '@/locales/en/portfolio.json';
import zhTW from '@/locales/zh-TW/portfolio.json';

type Bundle = typeof en;

const BUNDLES: Array<[string, Bundle]> = [
    ['en', en],
    ['zh-TW', zhTW as unknown as Bundle],
];

/** The milestone ids `generateMilestones` hands the tracker. */
const MILESTONE_KEYS = ['firstStep', 'foundation', 'tenPercent', 'quarter', 'halfway', 'threeQuarters', 'freedom'];

describe('retirement tracker copy', () => {
    it.each(BUNDLES)('names every financial stage in %s', (_lang, bundle) => {
        const stages = bundle.retirement.stages as Record<string, { label?: string; description?: string }>;

        for (const stage of FINANCIAL_STAGES) {
            expect(stages[stage.key]?.label).toBeTruthy();
            expect(stages[stage.key]?.description).toBeTruthy();
        }
    });

    it.each(BUNDLES)('carries no copy for a stage that no longer exists in %s', (_lang, bundle) => {
        // The other direction: a renamed stage leaves its old block behind,
        // and nothing renders it, so it rots unnoticed.
        const ids = FINANCIAL_STAGES.map((stage) => stage.key);
        expect(Object.keys(bundle.retirement.stages).sort()).toEqual([...ids].sort());
    });

    it.each(BUNDLES)('names every milestone in %s', (_lang, bundle) => {
        const milestones = bundle.retirement.milestones as Record<string, string>;

        for (const key of MILESTONE_KEYS) {
            expect(milestones[key]).toBeTruthy();
        }
        expect(Object.keys(milestones).sort()).toEqual([...MILESTONE_KEYS].sort());
    });
});
