import { readPrefill } from '@/lib/transactions/prefill';
import { toDateInputValue } from '@/utils/formatters';

const read = (q: string) => readPrefill(new URLSearchParams(q));

describe('readPrefill — what a link may start the add form with', () => {
  it('takes every cash field that fits', () => {
    expect(read('type=expense&amount=250&currency=USD&description=Lunch&category=Dining&walletType=emergency&paymentMethod=cash&date=2026-11-01')).toEqual({
      type: 'expense', amount: '250', currency: 'USD', description: 'Lunch', category: 'Dining',
      walletType: 'emergency', paymentMethod: 'cash', date: '2026-11-01',
    });
  });

  it('starts nothing for a transfer, an investment or no type', () => {
    expect(read('type=transfer&amount=5')).toBeNull();
    expect(read('type=investment')).toBeNull();
    expect(read('amount=5')).toBeNull();
  });

  it('never accepts the Portfolio wallet: cash lives in Life and Emergency only', () => {
    expect(read('type=expense&walletType=portfolio')?.walletType).toBeUndefined();
  });

  it('drops values the form does not offer, rather than failing', () => {
    const p = read('type=income&amount=-3&currency=XXX&category=Dining&paymentMethod=gold&date=2026-13-45');
    expect(p).toEqual({ type: 'income' });
  });

  it('never links a loan: paying one down stays an explicit choice', () => {
    expect(read('type=expense&category=Loan%20Payment&loanId=L1')).toEqual({ type: 'expense', category: 'Loan Payment' });
  });

  it('caps a long description', () => {
    expect(read(`type=expense&description=${'x'.repeat(500)}`)?.description).toHaveLength(200);
  });
});

describe('toDateInputValue', () => {
  // The suite runs in Asia/Taipei (jest.config), where the bug showed.
  it('keeps a bare API day as written', () => {
    expect(toDateInputValue('2026-11-01')).toBe('2026-11-01');
    expect(toDateInputValue('2026-11-01T00:00:00Z')).toBe('2026-11-01');
  });

  it('reads a Date as its local day, not its UTC one (a demo row at local midnight loaded a day early)', () => {
    expect(toDateInputValue(new Date(2026, 10, 1))).toBe('2026-11-01');
  });
});
