import {
    getExpenseGroupKey,
    isEarnedIncome,
    isWalletTransfer,
} from '@/utils/expenseGroups';

describe('getExpenseGroupKey', () => {
    it('maps the four spending buckets, in either language', () => {
        expect(getExpenseGroupKey('Dining')).toBe('food');
        expect(getExpenseGroupKey('飲食')).toBe('food');
        expect(getExpenseGroupKey('Transportation')).toBe('transport');
        expect(getExpenseGroupKey('Housing')).toBe('housing');
        expect(getExpenseGroupKey('Shopping')).toBe('other');
    });

    it('returns null for money that is not spending', () => {
        expect(getExpenseGroupKey('Investment Purchase')).toBeNull(); // saving
        expect(getExpenseGroupKey('Transfer')).toBeNull();            // own-wallet move
        expect(getExpenseGroupKey('轉帳')).toBeNull();
    });
});

describe('isWalletTransfer', () => {
    it('recognises a leg by its transfer group, whichever spelling arrives', () => {
        expect(isWalletTransfer({ category: 'Shopping', transferGroupId: 'grp-1' })).toBe(true);
        expect(isWalletTransfer({ category: 'Shopping', transfer_group_id: 'grp-1' })).toBe(true);
    });

    it('falls back to the category for legs written before that column existed', () => {
        expect(isWalletTransfer({ category: 'Transfer' })).toBe(true);
        expect(isWalletTransfer({ category: ' 轉帳 ' })).toBe(true);
    });

    it('matches the compound spellings people and importers actually write', () => {
        for (const c of ['Bank Transfer', 'Wallet transfer', 'Transfer to Emergency',
            'Transfer between wallets', 'Internal Transfer', '轉帳支出', '轉入', '轉出']) {
            expect(isWalletTransfer({ category: c })).toBe(true);
        }
    });

    it('does not swallow 調帳 — a bookkeeping adjustment is not a wallet move', () => {
        expect(isWalletTransfer({ category: '調帳' })).toBe(false);
        expect(getExpenseGroupKey('調帳')).toBe('other');
    });

    it('leaves a category that merely contains the word alone', () => {
        // 薪資轉帳 is salary that arrived by bank transfer — earned income. 轉帳手續費
        // is what the bank charged for the transfer — real spending. Dropping either
        // as an internal move understates the averages exactly as counting a transfer
        // leg overstated them.
        expect(isWalletTransfer({ category: '薪資轉帳' })).toBe(false);
        expect(isEarnedIncome('薪資轉帳')).toBe(true);

        expect(isWalletTransfer({ category: '轉帳手續費' })).toBe(false);
        expect(getExpenseGroupKey('轉帳手續費')).toBe('other');

        expect(isWalletTransfer({ category: 'Transfer fee' })).toBe(false);
        expect(getExpenseGroupKey('Transfer fee')).toBe('other');
    });

    it('still recognises a transfer leg by its group id whatever the category says', () => {
        // The group id is stamped by create_transfer and outranks the spelling.
        expect(isWalletTransfer({ category: '薪資轉帳', transferGroupId: 'grp-1' })).toBe(true);
    });

    it('leaves ordinary rows alone', () => {
        expect(isWalletTransfer({ category: 'Dining' })).toBe(false);
        expect(isWalletTransfer({ category: 'Salary', transferGroupId: null })).toBe(false);
        expect(isWalletTransfer({})).toBe(false);
    });
});

describe('isEarnedIncome', () => {
    it('counts recurring earnings only', () => {
        expect(isEarnedIncome('Salary')).toBe(true);
        expect(isEarnedIncome('Freelance')).toBe(true);
        expect(isEarnedIncome('月薪')).toBe(true);
    });

    it('rejects one-off and borrowed inflows', () => {
        expect(isEarnedIncome('Loan Receipt')).toBe(false);
        expect(isEarnedIncome('Others')).toBe(false);
        expect(isEarnedIncome('Gift')).toBe(false);
        expect(isEarnedIncome('Transfer')).toBe(false);
        expect(isEarnedIncome('Investment Returns')).toBe(false);
        expect(isEarnedIncome(null)).toBe(false);
    });
});
