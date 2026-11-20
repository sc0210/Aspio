import i18next from 'i18next';
import en from '@/locales/en/transactions.json';
import zh from '@/locales/zh-TW/transactions.json';
import { categoryLabel } from '@/lib/transactions/categoryLabel';

const make = async (lng: string) => {
    const i = i18next.createInstance();
    await i.init({ lng, ns: ['transactions'], resources: { en: { transactions: en }, 'zh-TW': { transactions: zh } } });
    return i.t;
};

describe('categoryLabel', () => {
    it('gives the form\'s name for a stored value, in each language', async () => {
        expect(categoryLabel('Entertainment', await make('en'))).toBe('Fun');
        expect(categoryLabel('Dining', await make('zh-TW'))).toBe('餐飲');
    });

    it('falls back to the stored value for unknown (custom/legacy) categories', async () => {
        expect(categoryLabel('Pet Supplies', await make('zh-TW'))).toBe('Pet Supplies');
        expect(categoryLabel(undefined, await make('en'))).toBe('');
    });
});
