/**
 * The payment methods the backend accepts, and a way to turn free text into one.
 *
 * Mirrors `PaymentMethod` in backend/app/modules/transactions/models.py — keep
 * the two in step. Other lists in the frontend serve other purposes:
 * `PAYMENT_METHODS` in utils/constants.ts is a display list (it includes
 * `paymaya`, which the backend rejects), and `AsianPaymentMethod` in shared
 * types is a different vocabulary altogether.
 */

export const BACKEND_PAYMENT_METHODS = [
  'cash', 'credit_card', 'debit_card', 'bank_transfer',
  // QR-based
  'wechat_pay', 'alipay', 'line_pay', 'shopee_pay', 'grab_pay', 'momo', 'qr_code', 'paynow',
  // E-wallets
  'digital_wallet', 'touch_n_go', 'boost', 'gcash', 'dana', 'ovo', 'gopay',
  // Other
  'cryptocurrency', 'cheque', 'other',
] as const;

type BackendPaymentMethod = (typeof BACKEND_PAYMENT_METHODS)[number];

const VALUES = new Set<string>(BACKEND_PAYMENT_METHODS);

// Display spellings that do not normalise onto the enum value by themselves.
const ALIASES: Record<string, BackendPaymentMethod> = {
  grabpay: 'grab_pay',
  shopeepay: 'shopee_pay',
  linepay: 'line_pay',
  wechatpay: 'wechat_pay',
  e_wallet: 'digital_wallet',
  ewallet: 'digital_wallet',
  crypto: 'cryptocurrency',
  check: 'cheque',
};

// What a reader of this Chinese-first app types into the field. Checked before
// the ASCII normalisation below, which would reduce these to nothing.
const ZH_ALIASES: Record<string, BackendPaymentMethod> = {
  現金: 'cash',
  信用卡: 'credit_card',
  簽帳卡: 'debit_card',
  金融卡: 'debit_card',
  轉帳: 'bank_transfer',
  銀行轉帳: 'bank_transfer',
  微信支付: 'wechat_pay',
  支付寶: 'alipay',
  電子錢包: 'digital_wallet',
  加密貨幣: 'cryptocurrency',
  支票: 'cheque',
  其他: 'other',
};

/**
 * Free text ("GCash", "Touch 'n Go", "LINE Pay", "信用卡") → the backend's value,
 * or undefined when it names none. Undefined is sent as no payment method, which
 * the backend accepts; an unknown string would be rejected with a 422.
 */
export function toBackendPaymentMethod(value?: string | null): BackendPaymentMethod | undefined {
  if (!value) return undefined;
  const zh = ZH_ALIASES[value.trim().replace(/\s+/g, '')];
  if (zh) return zh;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (VALUES.has(normalized)) return normalized as BackendPaymentMethod;
  return ALIASES[normalized];
}
