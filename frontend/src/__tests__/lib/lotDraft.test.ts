/**
 * The lot row's four editable figures, and which stored number each one sets.
 */

import { editLotDraft, hasLotDraftErrors, lotDraft, lotDraftErrors } from '@/lib/portfolio/lotDraft';

const lending = { quantity: 10688.88, averageCost: 1, currentPrice: 1 };

describe('lotDraft', () => {
    it('starts from the lot, with totals derived from quantity', () => {
        const draft = lotDraft(lending);

        expect(draft.text).toEqual({
            quantity: '10688.88',
            averageCost: '1',
            totalCost: '10688.88',
            currentValue: '10688.88',
        });
    });

    it('turns a typed total cost into the cost per unit behind it', () => {
        const draft = editLotDraft(lotDraft(lending), 'totalCost', '10000');

        expect(draft.averageCost).toBeCloseTo(10000 / 10688.88, 12);
        expect(draft.quantity * draft.averageCost).toBeCloseTo(10000, 8);
        // Ten places, not a rounded 0.94 — the figure shown has to be the one
        // that reproduces the typed total when it is read back. Derived rather
        // than written out: the literal here was 0.9355514534, which is 2.6e-7
        // low and multiplies back to 9999.9972.
        expect(draft.text.averageCost).toBe(String(Number((10000 / 10688.88).toFixed(10))));
        expect(Number(draft.text.averageCost) * lending.quantity).toBeCloseTo(10000, 6);
        // The price is untouched: cost and value are separate numbers.
        expect(draft.currentPrice).toBe(1);
    });

    it('turns a typed current value into a price', () => {
        const draft = editLotDraft(lotDraft(lending), 'currentValue', '10712.34');

        expect(draft.quantity * draft.currentPrice).toBeCloseTo(10712.34, 8);
        expect(draft.averageCost).toBe(1);
    });

    it('keeps the field being typed in exactly as typed', () => {
        // Rewriting it from quantity × cost would read back as 9999.999999999998.
        const draft = editLotDraft(lotDraft(lending), 'totalCost', '10000');
        expect(draft.text.totalCost).toBe('10000');
    });

    it('recomputes both totals when quantity changes, keeping the per-unit figures', () => {
        const draft = editLotDraft(lotDraft(lending), 'quantity', '500');

        expect(draft.text.totalCost).toBe('500');
        expect(draft.text.currentValue).toBe('500');
        expect(draft.averageCost).toBe(1);
    });

    it.each(['', '-', '1e', 'abc'])('holds %p as text without changing any number', (text) => {
        const draft = editLotDraft(lotDraft(lending), 'totalCost', text);

        expect(draft.text.totalCost).toBe(text);
        expect(draft.averageCost).toBe(1);
    });

    it('does not divide a total by a zero quantity', () => {
        const draft = editLotDraft(
            lotDraft({ quantity: 0, averageCost: 1, currentPrice: 1 }),
            'currentValue',
            '100',
        );

        expect(draft.currentPrice).toBe(1);
        expect(draft.text.currentValue).toBe('100');
    });
});

describe('lotDraftErrors', () => {
    it('reports nothing for an untouched lot', () => {
        expect(lotDraftErrors(lotDraft(lending))).toEqual({});
        expect(hasLotDraftErrors(lotDraft(lending))).toBe(false);
    });

    it('flags a negative quantity the draft ignored, so Save cannot report it as saved', () => {
        const draft = editLotDraft(lotDraft(lending), 'quantity', '-5');

        // The number was dropped while the input still shows -5 ...
        expect(draft.quantity).toBe(lending.quantity);
        expect(draft.text.quantity).toBe('-5');
        // ... so the draft must not be saveable.
        expect(lotDraftErrors(draft)).toEqual({ quantity: 'negative' });
        expect(hasLotDraftErrors(draft)).toBe(true);
    });

    it.each(['averageCost', 'totalCost'] as const)('flags a negative %s', (field) => {
        const draft = editLotDraft(lotDraft(lending), field, '-1');
        expect(lotDraftErrors(draft)[field]).toBe('negative');
    });

    it.each(['', '-', 'abc'])('flags unfinished text %p as required', (text) => {
        const draft = editLotDraft(lotDraft(lending), 'averageCost', text);
        expect(lotDraftErrors(draft).averageCost).toBe('required');
    });

    it('flags a total typed with no quantity to divide it by', () => {
        const draft = editLotDraft(
            lotDraft({ quantity: 0, averageCost: 1, currentPrice: 1 }),
            'currentValue',
            '100',
        );
        expect(lotDraftErrors(draft)).toEqual({ currentValue: 'noQuantity' });
    });

    it('clears once the field is fixed', () => {
        const bad = editLotDraft(lotDraft(lending), 'quantity', '-5');
        const fixed = editLotDraft(bad, 'quantity', '5');
        expect(lotDraftErrors(fixed)).toEqual({});
        expect(fixed.quantity).toBe(5);
    });
});
