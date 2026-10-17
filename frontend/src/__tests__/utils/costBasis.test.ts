/**
 * Cost basis allocation tests.
 *
 * This module decides which lots a sale consumes and therefore what gain gets
 * reported, but had no tests at all. The ordering guards below matter in
 * particular: the API returns holdings ordered by total_value desc, so any
 * caller can hand these functions lots in an order unrelated to purchase date.
 * FIFO must still mean oldest-first.
 */

import { calculateCostBasis, Lot } from '@/utils/costBasis';

const lot = (id: string, isoDate: string, quantity: number, costPerShare: number): Lot => ({
  id,
  purchaseDate: new Date(isoDate),
  quantity,
  costPerShare,
  totalCost: quantity * costPerShare,
});

// Deliberately constructed so each method picks a different lot first.
const OLDEST = lot('oldest', '2024-01-01', 10, 100); // cheapest
const MIDDLE = lot('middle', '2025-01-01', 10, 200);
const NEWEST = lot('newest', '2026-01-01', 10, 300); // priciest

// Passed in an order that is neither chronological nor reverse-chronological,
// mimicking the value-desc order the portfolio API actually returns.
const UNSORTED: Lot[] = [NEWEST, OLDEST, MIDDLE];

describe('calculateCostBasis', () => {
  describe('FIFO', () => {
    it('consumes the oldest lot first regardless of input order', () => {
      const result = calculateCostBasis(UNSORTED, 10, 'FIFO');

      expect(result.saleLots).toHaveLength(1);
      expect(result.saleLots[0].lotId).toBe('oldest');
      expect(result.totalCostBasis).toBe(1000);
    });

    it('splits a partial lot and keeps the remainder', () => {
      // 10 from `oldest` (1000) + 5 of `middle` at 200/share (1000)
      const result = calculateCostBasis(UNSORTED, 15, 'FIFO');

      expect(result.saleLots.map(s => s.lotId)).toEqual(['oldest', 'middle']);
      expect(result.totalCostBasis).toBe(2000);

      const leftoverMiddle = result.remainingLots.find(l => l.id === 'middle');
      expect(leftoverMiddle?.quantity).toBe(5);
      expect(leftoverMiddle?.totalCost).toBe(1000);
      // The untouched lot survives whole.
      expect(result.remainingLots.find(l => l.id === 'newest')?.quantity).toBe(10);
    });
  });

  describe('LIFO', () => {
    it('consumes the newest lot first regardless of input order', () => {
      const result = calculateCostBasis(UNSORTED, 10, 'LIFO');

      expect(result.saleLots[0].lotId).toBe('newest');
      expect(result.totalCostBasis).toBe(3000);
    });

    it('reports a different basis than FIFO for the same quantity', () => {
      const fifo = calculateCostBasis(UNSORTED, 15, 'FIFO');
      const lifo = calculateCostBasis(UNSORTED, 15, 'LIFO');

      expect(fifo.totalCostBasis).toBe(2000); // 1000 + 1000
      expect(lifo.totalCostBasis).toBe(4000); // 3000 + 1000
    });
  });

  describe('AVERAGE', () => {
    it('prices every share at the blended average', () => {
      // 30 shares costing 6000 => 200/share
      const result = calculateCostBasis(UNSORTED, 15, 'AVERAGE');

      expect(result.totalCostBasis).toBe(3000);
      expect(result.saleLots.reduce((n, s) => n + s.quantitySold, 0)).toBe(15);
    });
  });

  describe('SPECIFIC', () => {
    it('uses only the nominated lots', () => {
      const result = calculateCostBasis(UNSORTED, 10, 'SPECIFIC', ['newest']);

      expect(result.saleLots).toHaveLength(1);
      expect(result.saleLots[0].lotId).toBe('newest');
      expect(result.totalCostBasis).toBe(3000);
    });

    it('returns unselected lots as remaining', () => {
      const result = calculateCostBasis(UNSORTED, 10, 'SPECIFIC', ['newest']);
      const remainingIds = result.remainingLots.map(l => l.id).sort();

      expect(remainingIds).toEqual(['middle', 'oldest']);
    });

    it('rejects a sale the nominated lots cannot cover', () => {
      expect(() => calculateCostBasis(UNSORTED, 15, 'SPECIFIC', ['newest'])).toThrow(
        /insufficient quantity/i,
      );
    });

    it('rejects an empty selection', () => {
      expect(() => calculateCostBasis(UNSORTED, 5, 'SPECIFIC', [])).toThrow(
        /specific lot ids must be provided/i,
      );
    });
  });

  describe('guards', () => {
    it('rejects a non-positive quantity', () => {
      expect(() => calculateCostBasis(UNSORTED, 0, 'FIFO')).toThrow(/greater than 0/i);
      expect(() => calculateCostBasis(UNSORTED, -5, 'FIFO')).toThrow(/greater than 0/i);
    });

    it('rejects selling more than is held, rather than silently under-filling', () => {
      expect(() => calculateCostBasis(UNSORTED, 31, 'FIFO')).toThrow(/insufficient quantity/i);
    });

    it('allows selling the entire position', () => {
      const result = calculateCostBasis(UNSORTED, 30, 'FIFO');

      expect(result.totalCostBasis).toBe(6000);
      expect(result.remainingLots).toHaveLength(0);
    });

    it('rejects an unknown method', () => {
      // Cast: the point is to prove the runtime default branch still guards.
      expect(() => calculateCostBasis(UNSORTED, 5, 'HIFO' as never)).toThrow(
        /unknown cost basis method/i,
      );
    });
  });

  it('does not mutate the caller’s lots array', () => {
    const input = [...UNSORTED];
    const orderBefore = input.map(l => l.id);

    calculateCostBasis(input, 15, 'FIFO');
    calculateCostBasis(input, 15, 'LIFO');

    expect(input.map(l => l.id)).toEqual(orderBefore);
    expect(input.find(l => l.id === 'oldest')?.quantity).toBe(10);
  });
});
