/**
 * Named buy-vs-rent setups kept side by side — "the Xinyi flat at 30% down" vs
 * "the Banqiao one at 20%". Per-viewer and per-browser on purpose: these are
 * what-ifs, not records, and nothing else in the app reads them.
 *
 * Storage can be missing, full, blocked or hand-edited, so every read is
 * validated and every write is best-effort.
 */

import { DEFAULT_BUY_VS_RENT, type BuyVsRentInputs } from './buyVsRent';

export interface SavedScenario {
    id: string;
    name: string;
    inputs: BuyVsRentInputs;
}

export const SCENARIOS_KEY = 'aspiro-housing-scenarios';
/** Three is a comparison; more is a spreadsheet. */
export const MAX_SCENARIOS = 3;
export const MAX_NAME = 40;

function storage(): Storage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

/**
 * Each field's allowed range — the simulator's own slider bounds, plus a sane
 * ceiling for the typed-in price and rent. A hand-edited save with
 * `holdingYears: 1e9` would otherwise loop the projection for billions of
 * months and freeze the tab.
 */
const RANGES: Record<keyof BuyVsRentInputs, [number, number]> = {
    housePrice: [1, 1e10],
    downPaymentPct: [10, 60],
    mortgageRatePct: [1, 6],
    mortgageTermYears: [5, 40],
    buyingCostPct: [0, 8],
    sellingCostPct: [0, 8],
    ownershipCostPctPerYear: [0, 3],
    appreciationPct: [-2, 6],
    monthlyRent: [0, 1e7],
    rentGrowthPct: [0, 6],
    investmentReturnPct: [0, 12],
    holdingYears: [3, 30],
};

/** Fills fields added since a scenario was saved; anything non-numeric or out of range falls back to the default. */
function sanitize(raw: unknown): BuyVsRentInputs {
    const out: BuyVsRentInputs = { ...DEFAULT_BUY_VS_RENT };
    if (raw && typeof raw === 'object') {
        for (const key of Object.keys(DEFAULT_BUY_VS_RENT) as Array<keyof BuyVsRentInputs>) {
            const v = (raw as Record<string, unknown>)[key];
            const [min, max] = RANGES[key];
            if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) out[key] = v;
        }
    }
    return out;
}

export function loadScenarios(): SavedScenario[] {
    const s = storage();
    if (!s) return [];
    try {
        const parsed: unknown = JSON.parse(s.getItem(SCENARIOS_KEY) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((x): x is { id: unknown; name: unknown; inputs: unknown } => !!x && typeof x === 'object')
            .filter((x) => typeof x.id === 'string' && typeof x.name === 'string')
            .slice(0, MAX_SCENARIOS)
            .map((x) => ({ id: x.id as string, name: (x.name as string).slice(0, MAX_NAME), inputs: sanitize(x.inputs) }));
    } catch {
        return [];
    }
}

/** Returns false when storage refused the write — the caller keeps its state either way. */
export function storeScenarios(list: SavedScenario[]): boolean {
    const s = storage();
    if (!s) return false;
    try {
        s.setItem(SCENARIOS_KEY, JSON.stringify(list.slice(0, MAX_SCENARIOS)));
        return true;
    } catch {
        return false;
    }
}

export function addScenario(list: SavedScenario[], name: string, inputs: BuyVsRentInputs, id: string): SavedScenario[] {
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (!trimmed || list.length >= MAX_SCENARIOS) return list;
    return [...list, { id, name: trimmed, inputs: { ...inputs } }];
}
