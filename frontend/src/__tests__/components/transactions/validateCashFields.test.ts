import { validateCashFields, type CashFormData } from '@/components/transactions/TransactionFormFields';

// A fake t that tags each key, so a message that skips translation shows up as plain English.
const t = ((key: string) => `t:${key}`) as unknown as Parameters<typeof validateCashFields>[1];

const base: CashFormData = {
  type: 'expense', amount: '120', currency: 'TWD', description: 'Lunch', category: 'Dining',
  paymentMethod: '', walletType: 'life', fromWallet: 'life', toWallet: 'emergency',
  date: '2026-10-18', tags: [], loanId: '',
};

describe('validateCashFields', () => {
  it('accepts a complete expense', () => {
    expect(validateCashFields(base, t)).toEqual({});
  });

  it('translates every message (the edit page used to show English only)', () => {
    expect(validateCashFields({ ...base, amount: '', description: ' ', category: '' }, t)).toEqual({
      amount: 't:transactions:form.errAmount',
      description: 't:transactions:form.errDescription',
      category: 't:transactions:form.errCategory',
    });
  });

  it('rejects a non-numeric or non-positive amount', () => {
    expect(validateCashFields({ ...base, amount: 'abc' }, t).amount).toBeDefined();
    expect(validateCashFields({ ...base, amount: '0' }, t).amount).toBeDefined();
  });

  it('needs no category for a transfer, but two different wallets', () => {
    const transfer = { ...base, type: 'transfer', category: '' };
    expect(validateCashFields(transfer, t)).toEqual({});
    expect(validateCashFields({ ...transfer, toWallet: 'life' }, t)).toEqual({
      transfer: 't:transactions:form.errSameWallet',
    });
  });
});
