/**
 * The holding editor's lot row, as the numbers a person types.
 *
 * A lot stores quantity, average cost and a current price. What a person
 * usually knows is the totals, above all for a lending position: its cost is
 * what you lent and its value is that plus interest. So all four figures are
 * editable, and typing a total sets the per-unit figure behind it:
 *
 *   total cost    = quantity × average cost    (typing it sets average cost)
 *   current value = quantity × current price  (typing it sets the price)
 *
 * Each input keeps its text exactly as typed. Rewriting the field under the
 * cursor from the derived number would turn "10000" into "9999.999999999998"
 * mid-keystroke.
 */

export type LotDraftField = 'quantity' | 'averageCost' | 'totalCost' | 'currentValue';

interface LotNumbers {
    quantity: number;
    averageCost: number;
    currentPrice: number;
}

export interface LotDraft extends LotNumbers {
    text: Record<LotDraftField, string>;
}

const money = (n: number): string =>
    Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';

// Ten places, matching the columns the backend stores these in.
const perUnit = (n: number): string =>
    Number.isFinite(n) ? String(Number(n.toFixed(10))) : '';

function withText(numbers: LotNumbers, typed?: { field: LotDraftField; text: string }): LotDraft {
    const text: Record<LotDraftField, string> = {
        quantity: perUnit(numbers.quantity),
        averageCost: perUnit(numbers.averageCost),
        totalCost: money(numbers.quantity * numbers.averageCost),
        currentValue: money(numbers.quantity * numbers.currentPrice),
    };
    if (typed) text[typed.field] = typed.text;
    return { ...numbers, text };
}

export function lotDraft(lot: LotNumbers): LotDraft {
    return withText({
        quantity: lot.quantity,
        averageCost: lot.averageCost,
        currentPrice: lot.currentPrice,
    });
}

/**
 * Apply one keystroke's text to one field.
 *
 * Text that is not a number yet ("", "1.", "-") is kept but changes nothing, and
 * a total with no quantity to divide by is kept and waits for one.
 */
export function editLotDraft(draft: LotDraft, field: LotDraftField, text: string): LotDraft {
    const next: LotNumbers = {
        quantity: draft.quantity,
        averageCost: draft.averageCost,
        currentPrice: draft.currentPrice,
    };
    const value = Number(text);

    if (text.trim() !== '' && Number.isFinite(value) && value >= 0) {
        switch (field) {
            case 'quantity':
                next.quantity = value;
                break;
            case 'averageCost':
                next.averageCost = value;
                break;
            case 'totalCost':
                if (next.quantity > 0) next.averageCost = value / next.quantity;
                break;
            case 'currentValue':
                if (next.quantity > 0) next.currentPrice = value / next.quantity;
                break;
        }
    }

    return withText(next, { field, text });
}

/**
 * Why a field's text cannot be saved.
 *
 * `editLotDraft` keeps text it cannot use — a negative, a half-typed number,
 * a total with no quantity to divide — and leaves the numbers alone. That is
 * right while typing, but Save sends the numbers, so saving such a draft would
 * quietly drop the edit while the input still shows it. Save checks this first.
 */
type LotDraftError = 'required' | 'negative' | 'noQuantity';

const FIELDS: LotDraftField[] = ['quantity', 'averageCost', 'totalCost', 'currentValue'];

/** Pass `fields` to check only the inputs actually shown: an error on a hidden one blocks Save with nothing to fix. */
export function lotDraftErrors(
    draft: LotDraft,
    fields: LotDraftField[] = FIELDS,
): Partial<Record<LotDraftField, LotDraftError>> {
    const errors: Partial<Record<LotDraftField, LotDraftError>> = {};
    for (const field of fields) {
        const text = draft.text[field];
        const value = Number(text);
        if (text.trim() === '' || !Number.isFinite(value)) {
            errors[field] = 'required';
        } else if (value < 0) {
            errors[field] = 'negative';
        } else if (
            (field === 'totalCost' || field === 'currentValue') &&
            value > 0 &&
            !(draft.quantity > 0)
        ) {
            errors[field] = 'noQuantity';
        }
    }
    return errors;
}

export function hasLotDraftErrors(draft: LotDraft): boolean {
    return Object.keys(lotDraftErrors(draft)).length > 0;
}
