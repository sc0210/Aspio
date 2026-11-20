import { PAYMENT_METHODS } from '@/components/transactions/TransactionFormFields';
import { BACKEND_PAYMENT_METHODS } from '@/utils/paymentMethods';
import en from '@/locales/en/transactions.json';
import zh from '@/locales/zh-TW/transactions.json';

describe('payment methods the form offers', () => {
    it('are all values the backend PaymentMethod enum accepts (else a 422 on save)', () => {
        for (const { value } of PAYMENT_METHODS) expect(BACKEND_PAYMENT_METHODS).toContain(value);
    });

    it('each has a label in both locales', () => {
        for (const { value } of PAYMENT_METHODS) {
            expect((en.form.paymentMethods as Record<string, string>)[value]).toBeTruthy();
            expect((zh.form.paymentMethods as Record<string, string>)[value]).toBeTruthy();
        }
    });
});
