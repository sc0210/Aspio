import type { SplitOut, SplitStatus } from '@/shared/types';

/**
 * The numbers behind the Shared Spending insights, from the splits the tab
 * already loaded. Only accepted splits count: a proposal is in no one's books
 * yet, and a declined, withdrawn or cancelled bill was never shared spending.
 * Accepted splits are listed without a limit, so these totals are complete.
 *
 * Amounts never mix currencies: every figure is for one currency.
 */

/** 'YYYY-MM' of an ISO date. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** The month `delta` months from `month` ('YYYY-MM'). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' as a month name in `locale`, e.g. "November 2026" or "Nov". */
export function monthLabel(month: string, locale: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: style === 'long' ? 'numeric' : undefined, month: style, timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export const accepted = (splits: SplitOut[]): SplitOut[] => splits.filter((s) => s.status === 'active');

/** Currencies with accepted splits, most-used first (ties: alphabetical). */
export function currenciesByUse(splits: SplitOut[]): string[] {
  const counts = new Map<string, number>();
  for (const s of accepted(splits)) counts.set(s.currency, (counts.get(s.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

const cents = (n: number) => Math.round(n * 100) / 100;

export interface SharedSummary {
  count: number;
  total: number;
  mine: number;
  partner: number;
  /** Whole bills you paid up front. */
  iFronted: number;
  /** Whole bills your partner(s) paid up front. */
  partnerFronted: number;
}

/** Accepted splits in one currency, in one month or (month null) all time. */
function scoped(splits: SplitOut[], currency: string, month: string | null): SplitOut[] {
  return accepted(splits).filter((s) => s.currency === currency && (month === null || monthOf(s.split_date) === month));
}

export function summarize(splits: SplitOut[], currency: string, month: string | null): SharedSummary {
  const out: SharedSummary = { count: 0, total: 0, mine: 0, partner: 0, iFronted: 0, partnerFronted: 0 };
  for (const s of scoped(splits, currency, month)) {
    out.count += 1;
    out.total += s.total_amount;
    out.mine += s.my_share;
    out.partner += s.partner_share;
    if (s.payer_is_me) out.iFronted += s.total_amount;
    else out.partnerFronted += s.total_amount;
  }
  return {
    ...out, total: cents(out.total), mine: cents(out.mine), partner: cents(out.partner),
    iFronted: cents(out.iFronted), partnerFronted: cents(out.partnerFronted),
  };
}

export interface CategoryTotal {
  /** The category's name, or null for bills without one. */
  name: string | null;
  total: number;
  mine: number;
}

/**
 * One label per partner connection: the name, or "Bob (2)" when two partners
 * share it, numbered in connection order. Build it once from every bill and
 * pass it on: numbered from a narrowed list, Bob (2) would read plain "Bob".
 */
export type PartnerLabels = Map<string, string>;

export function partnerLabels(splits: SplitOut[]): PartnerLabels {
  const names = new Map<string, string>();
  for (const s of splits) names.set(s.connection_id, s.partner_name);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const [id, name] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    labels.set(id, n === 1 ? name : `${name} (${n})`);
  }
  return labels;
}

export interface PartnerFronted {
  connectionId: string;
  name: string;
  amount: number;
}

/** Whole bills each partner paid up front, largest first: who is behind "partners paid". */
export function frontedByPartner(splits: SplitOut[], currency: string, month: string | null,
  labels: PartnerLabels = partnerLabels(splits)): PartnerFronted[] {
  const by = new Map<string, PartnerFronted>();
  for (const s of scoped(splits, currency, month)) {
    if (s.payer_is_me) continue;
    const row = by.get(s.connection_id)
      ?? { connectionId: s.connection_id, name: labels.get(s.connection_id) ?? s.partner_name, amount: 0 };
    row.amount += s.total_amount;
    by.set(s.connection_id, row);
  }
  return [...by.values()].map((r) => ({ ...r, amount: cents(r.amount) })).sort((a, b) => b.amount - a.amount);
}

/** Shared spending per category, largest first. */
export function byCategory(splits: SplitOut[], currency: string, month: string | null): CategoryTotal[] {
  const totals = new Map<string | null, CategoryTotal>();
  for (const s of scoped(splits, currency, month)) {
    const name = s.category_name ?? null;
    const row = totals.get(name) ?? { name, total: 0, mine: 0 };
    row.total += s.total_amount;
    row.mine += s.my_share;
    totals.set(name, row);
  }
  return [...totals.values()]
    .map((r) => ({ ...r, total: cents(r.total), mine: cents(r.mine) }))
    .sort((a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? ''));
}

export interface MonthTotal {
  month: string;
  mine: number;
  partner: number;
}

/** The `months` months ending at `endMonth`, oldest first; empty months are 0. */
export function byMonth(splits: SplitOut[], currency: string, endMonth: string, months = 6): MonthTotal[] {
  const rows = Array.from({ length: months }, (_, i) => ({ month: shiftMonth(endMonth, i - months + 1), mine: 0, partner: 0 }));
  const index = new Map(rows.map((r, i) => [r.month, i]));
  for (const s of accepted(splits)) {
    const i = s.currency === currency ? index.get(monthOf(s.split_date)) : undefined;
    if (i === undefined) continue;
    rows[i].mine += s.my_share;
    rows[i].partner += s.partner_share;
  }
  return rows.map((r) => ({ ...r, mine: cents(r.mine), partner: cents(r.partner) }));
}

// ---------------------------------------------------------------------------
// The Shared bills list: filter and export
// ---------------------------------------------------------------------------

export interface SplitFilter {
  /** 'YYYY-MM', or '' for any month. */
  month: string;
  /** A category name, NO_CATEGORY, or '' for any. */
  category: string;
  status: SplitStatus | '';
  payer: 'me' | 'partner' | '';
  /** A partner's connection id, or '' for everyone. An id, not a name: two partners can share a name. */
  partner: string;
  query: string;
}

export const NO_CATEGORY = '__none__';
export const EMPTY_FILTER: SplitFilter = { month: '', category: '', status: '', payer: '', partner: '', query: '' };

export const isFiltered = (f: SplitFilter): boolean =>
  f.month !== '' || f.category !== '' || f.status !== '' || f.payer !== '' || f.partner !== '' || f.query.trim() !== '';

export function filterSplits(splits: SplitOut[], f: SplitFilter): SplitOut[] {
  const q = f.query.trim().toLowerCase();
  return splits.filter((s) =>
    (f.month === '' || monthOf(s.split_date) === f.month)
    && (f.category === '' || (f.category === NO_CATEGORY ? !s.category_name : s.category_name === f.category))
    && (f.status === '' || s.status === f.status)
    && (f.payer === '' || (f.payer === 'me') === s.payer_is_me)
    && (f.partner === '' || s.connection_id === f.partner)
    && (q === '' || s.description.toLowerCase().includes(q) || s.partner_name.toLowerCase().includes(q)),
  );
}

/**
 * The distinct months and category names in a list, for the filter menus.
 * `keep` holds the current choices: a bill that changed or left the list must
 * not leave its filter selected but missing from the menu, hiding everything.
 */
export function filterOptions(splits: SplitOut[], keep: Pick<SplitFilter, 'month' | 'category'> & { partner?: string } = EMPTY_FILTER,
  labels: PartnerLabels = partnerLabels(splits)):
  { months: string[]; categories: string[]; uncategorised: boolean; partners: PartnerOption[] } {
  const months = [...new Set([...splits.map((s) => monthOf(s.split_date)), ...(keep.month ? [keep.month] : [])])].sort().reverse();
  const names = [...splits.map((s) => s.category_name), keep.category === NO_CATEGORY ? null : keep.category]
    .filter((n): n is string => !!n);
  return {
    months,
    categories: [...new Set(names)].sort((a, b) => a.localeCompare(b)),
    uncategorised: keep.category === NO_CATEGORY || splits.some((s) => !s.category_name),
    partners: partnerOptions(splits, keep.partner ?? '', labels),
  };
}

export interface PartnerOption {
  connectionId: string;
  /** null when the chosen partner has no bill left on the list to name them by. */
  name: string | null;
}

/** One entry per partner on the list, by label; a kept choice stays even with no bill left. */
function partnerOptions(splits: SplitOut[], keep: string, labels: PartnerLabels): PartnerOption[] {
  const ids = new Set(splits.map((s) => s.connection_id));
  if (keep) ids.add(keep);
  return [...ids].map((connectionId) => ({ connectionId, name: labels.get(connectionId) ?? null }))
    // By name, and a partner with no name to show last.
    .sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? '').localeCompare(b.name ?? ''));
}

function csvCell(value: string | number): string {
  const text = String(value);
  // Quote anything with a delimiter, quote or line break. Text a spreadsheet
  // could run as a formula (=, +, - or @ first, even after spaces, or a leading
  // tab or carriage return) is prefixed so it reads as text. A partner writes
  // descriptions, so this is someone else's input.
  const safe = typeof value === 'string' && /^(?:[\t\r]|[ ]*[=+\-@])/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_HEADER = ['Date', 'Description', 'Category', 'Partner', 'Paid by', 'Status', 'Currency', 'Total', 'My share', 'Partner share'];

export interface CsvLabels {
  me: string;
  partner: string;
  status: (status: SplitStatus) => string;
  category: (name: string) => string;
}

const RAW_LABELS: CsvLabels = { me: 'Me', partner: 'Partner', status: (s) => s, category: (n) => n };

/** One row per bill; the header and labels are passed in so they can be translated. */
export function splitsCsv(splits: SplitOut[], header: string[] = CSV_HEADER, labels: CsvLabels = RAW_LABELS): string {
  const rows = splits.map((s) => [
    s.split_date, s.description, s.category_name ? labels.category(s.category_name) : '', s.partner_name,
    s.payer_is_me ? labels.me : labels.partner, labels.status(s.status), s.currency, s.total_amount, s.my_share, s.partner_share,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
