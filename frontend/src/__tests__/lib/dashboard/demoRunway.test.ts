import { demoEmergencyRunway } from '@/lib/dashboard/demoRunway';

// Rent and salary land on the 1st; groceries through the month.
const txns = [
  { type: 'expense', amount: 20000, date: '2026-10-01' }, // rent, last month
  { type: 'expense', amount: 10000, date: '2026-10-15' }, // groceries, last month
  { type: 'income', amount: 60000, date: '2026-10-01' },
  { type: 'expense', amount: 20000, date: '2026-11-01' }, // rent, this month
  { type: 'expense', amount: 3000, date: '2026-11-03' },
];

describe('demoEmergencyRunway', () => {
  it('divides by the last complete month, so it is the same on the 1st, the 3rd and the 30th', () => {
    for (const day of [1, 3, 30]) {
      expect(demoEmergencyRunway(90000, txns, new Date(2026, 10, day, 12))).toBe(3); // 90k / 30k
    }
  });

  it('ignores income and this month’s partial spending', () => {
    expect(demoEmergencyRunway(30000, txns, new Date(2026, 10, 2, 12))).toBe(1);
  });

  it('is null when last month had no spending', () => {
    expect(demoEmergencyRunway(90000, txns, new Date(2027, 0, 15, 12))).toBeNull();
  });
});
