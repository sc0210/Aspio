/**
 * Ordering helpers for dragging transactions within one day (#478).
 *
 * The server stores the order (`day_position`) and the list already arrives in it;
 * these only cover the moment between a drop and the refetch, so the row lands
 * where it was dropped instead of jumping back and then forward again.
 */
import { localDateString } from '@/utils/formatters';
import type { Transaction } from '@/shared/types';

/**
 * The `YYYY-MM-DD` the backend knows a row's day by. The list passes dates through
 * as the backend's own string, so slice it rather than round-trip through a Date —
 * `new Date('2026-10-01')` is UTC midnight, which is a different local day west of
 * Greenwich. A Date (optimistic rows, demo fixtures) is a local calendar day.
 */
export function apiDate(date: Transaction['date']): string {
  if (typeof date === 'string') return date.slice(0, 10);
  return localDateString(date);
}

/**
 * `rows` in the order `order` gives. Rows the order does not mention — one added
 * after the drop, before the refetch — keep their relative order after it, which is
 * also where the server puts a row with no position.
 */
export function applyDayOrder<T extends { id: string }>(rows: T[], order?: string[]): T[] {
  if (!order || order.length === 0) return rows;
  const rank = new Map(order.map((id, i) => [id, i]));
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ra = rank.get(a.row.id);
      const rb = rank.get(b.row.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.i - b.i;
    })
    .map(({ row }) => row);
}

/** `ids` with `activeId` moved to where `overId` is; unchanged if either is absent. */
export function moveId(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
