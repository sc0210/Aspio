/**
 * Free text from the scan form becomes a payment method the backend accepts.
 *
 * The first version of this mapping knew 12 of the backend's 22 values, so
 * "GCash", "OVO" or "Touch 'n Go" — the markets the app is built for — were
 * silently saved as no payment method at all.
 */

import { BACKEND_PAYMENT_METHODS, toBackendPaymentMethod } from '@/utils/paymentMethods';

describe('toBackendPaymentMethod', () => {
  it.each(BACKEND_PAYMENT_METHODS)('keeps the backend value %s as it is', (value) => {
    expect(toBackendPaymentMethod(value)).toBe(value);
  });

  it.each([
    ['GCash', 'gcash'],
    ['OVO', 'ovo'],
    ['DANA', 'dana'],
    ['Boost', 'boost'],
    ['GoPay', 'gopay'],
    ["Touch 'n Go", 'touch_n_go'],
    ['LINE Pay', 'line_pay'],
    ['WeChat Pay', 'wechat_pay'],
    ['GrabPay', 'grab_pay'],
    ['Credit Card', 'credit_card'],
    ['e-wallet', 'digital_wallet'],
    // The app is Chinese-first; ASCII normalisation alone reduced these to nothing.
    ['現金', 'cash'],
    ['信用卡', 'credit_card'],
    [' 金融卡 ', 'debit_card'],
    ['銀行 轉帳', 'bank_transfer'],
    ['電子錢包', 'digital_wallet'],
  ])('maps "%s" to %s', (input, expected) => {
    expect(toBackendPaymentMethod(input)).toBe(expected);
  });

  it.each([undefined, null, '', '   ', 'PayMaya', 'barter'])('gives no payment method for %p', (input) => {
    expect(toBackendPaymentMethod(input)).toBeUndefined();
  });
});
