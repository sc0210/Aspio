import { apiDate, applyDayOrder, moveId } from '@/components/transactions/dayOrder';

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe('apiDate', () => {
  it('takes the backend date string as it is, never through a Date', () => {
    // new Date('2026-10-01') is UTC midnight — the 30th anywhere west of UTC.
    expect(apiDate('2026-10-01')).toBe('2026-10-01');
    expect(apiDate('2026-10-01T00:00:00Z')).toBe('2026-10-01');
  });

  it('reads a Date as the local calendar day', () => {
    expect(apiDate(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
});

describe('applyDayOrder', () => {
  it('puts the rows in the given order', () => {
    expect(ids(applyDayOrder(rows('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('keeps a row the order does not mention after the ordered ones, in its own order', () => {
    // A row added between the drop and the refetch: where the server puts it too.
    expect(ids(applyDayOrder(rows('new1', 'a', 'b', 'new2'), ['b', 'a']))).toEqual([
      'b', 'a', 'new1', 'new2',
    ]);
  });

  it('leaves the rows alone with no order', () => {
    const list = rows('a', 'b');
    expect(applyDayOrder(list, undefined)).toBe(list);
    expect(applyDayOrder(list, [])).toBe(list);
  });
});

describe('moveId', () => {
  it('moves an id down and up', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same array when nothing moves, so callers can skip the save', () => {
    const list = ['a', 'b'];
    expect(moveId(list, 'a', 'a')).toBe(list);
    expect(moveId(list, 'a', 'zzz')).toBe(list);
  });
});
