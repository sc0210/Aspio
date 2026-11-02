import { CATEGORIES, CURRENCIES, PAYMENT_METHODS } from '@/components/transactions/TransactionFormFields';

type CashType = 'expense' | 'income';

/**
 * What a link may start the add form with: today, every cash field of a row the
 * edit page's "Duplicate" copies. A query string
 * is user input, so each value is checked against what the form itself offers and
 * dropped (never an error) when it does not fit. Never a transfer or an investment:
 * those have their own pairing and holding rules. Never a Portfolio wallet: cash
 * lives in Life and Emergency only. Never a loan link: paying down a loan stays an
 * explicit choice in the form.
 */
export function readPrefill(params: Pick<URLSearchParams, 'get'>) {
  const type = params.get('type');
  if (type !== 'expense' && type !== 'income') return null;
  const out: { type: CashType; amount?: string; currency?: string; description?: string; category?: string; walletType?: string; paymentMethod?: string; date?: string } = { type };
  const amount = Number(params.get('amount'));
  if (params.get('amount') && Number.isFinite(amount) && amount > 0) out.amount = String(amount);
  const currency = params.get('currency');
  if (currency && CURRENCIES.includes(currency)) out.currency = currency;
  const description = params.get('description')?.trim();
  if (description) out.description = description.slice(0, 200);
  const category = params.get('category');
  if (category && CATEGORIES[type].some((c) => c.value === category)) out.category = category;
  const wallet = params.get('walletType');
  if (wallet === 'life' || wallet === 'emergency') out.walletType = wallet;
  const payment = params.get('paymentMethod');
  if (payment && PAYMENT_METHODS.some((m) => m.value === payment)) out.paymentMethod = payment;
  const date = params.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date).getTime())) out.date = date;
  return out;
}
