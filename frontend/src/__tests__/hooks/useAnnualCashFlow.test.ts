import { renderHook } from '@testing-library/react';
import { useAnnualCashFlow } from '@/hooks/useAnnualCashFlow';

const mockUseTransactions = jest.fn();
jest.mock('@/hooks/useTransactions', () => ({
    useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

/** ISO date `n` whole months before today, on the 10th. */
function monthsAgo(n: number): string {
    const d = new Date();
    d.setDate(10);
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
}

interface Row {
    transaction_date: string;
    amount: number;
    currency: string;
    type: string;
    category: string;
    transferGroupId?: string;
}

const row = (o: Partial<Row>): Row => ({
    transaction_date: monthsAgo(1),
    amount: 1000,
    currency: 'TWD',
    type: 'expense',
    category: 'Dining',
    ...o,
});

function setTx(transactions: Row[]) {
    mockUseTransactions.mockReturnValue({ transactions, isLoading: false });
}

describe('useAnnualCashFlow', () => {
    beforeEach(() => mockUseTransactions.mockReset());

    it('averages earned income and living expenses over the months with data', () => {
        setTx([
            row({ type: 'income', category: 'Salary', amount: 80_000, transaction_date: monthsAgo(1) }),
            row({ type: 'income', category: 'Salary', amount: 80_000, transaction_date: monthsAgo(2) }),
            row({ amount: 20_000, transaction_date: monthsAgo(1) }),
            row({ amount: 20_000, transaction_date: monthsAgo(2) }),
        ]);
        const { result } = renderHook(() => useAnnualCashFlow());
        expect(result.current.monthsAveraged).toBe(2);
        expect(result.current.avgMonthlyIncome).toBe(80_000);
        expect(result.current.avgMonthlyExpense).toBe(20_000);
        expect(result.current.hasData).toBe(true);
    });

    it('counts neither leg of a wallet transfer as income or spending', () => {
        const withoutTransfer = [
            row({ type: 'income', category: 'Salary', amount: 80_000 }),
            row({ amount: 20_000 }),
        ];
        setTx(withoutTransfer);
        const plain = renderHook(() => useAnnualCashFlow()).result.current;

        // Same two months, plus a 290,000 Life → Emergency top-up recorded as a
        // matching income/expense pair. Neither leg may move the averages.
        setTx([
            ...withoutTransfer,
            row({ type: 'expense', category: 'Transfer', amount: 290_000, transferGroupId: 'grp-1' }),
            row({ type: 'income', category: 'Transfer', amount: 290_000, transferGroupId: 'grp-1' }),
        ]);
        const withTransfer = renderHook(() => useAnnualCashFlow()).result.current;

        expect(withTransfer.avgMonthlyExpense).toBe(plain.avgMonthlyExpense);
        expect(withTransfer.avgMonthlyIncome).toBe(plain.avgMonthlyIncome);
    });

    it('excludes a transfer leg written before transfer_group_id existed', () => {
        setTx([
            row({ amount: 20_000 }),
            row({ type: 'expense', category: 'Transfer', amount: 290_000 }),
        ]);
        expect(renderHook(() => useAnnualCashFlow()).result.current.avgMonthlyExpense).toBe(20_000);
    });

    it('excludes investment purchases (saving) and non-earned income', () => {
        setTx([
            row({ type: 'income', category: 'Salary', amount: 80_000 }),
            row({ type: 'income', category: 'Loan Receipt', amount: 1_160_000 }),
            row({ type: 'income', category: 'Others', amount: 1_000_000 }),
            row({ type: 'expense', category: 'Investment Purchase', amount: 500_000 }),
            row({ amount: 20_000 }),
        ]);
        const { result } = renderHook(() => useAnnualCashFlow());
        expect(result.current.avgMonthlyIncome).toBe(80_000);
        expect(result.current.avgMonthlyExpense).toBe(20_000);
    });

    it('excludes a compound transfer spelling, not just the bare word', () => {
        setTx([
            row({ amount: 20_000 }),
            row({ category: 'Bank Transfer', amount: 190_000 }),
            row({ category: 'Transfer to Emergency', amount: 100_000 }),
            row({ category: '轉帳支出', amount: 50_000 }),
        ]);
        expect(renderHook(() => useAnnualCashFlow()).result.current.avgMonthlyExpense).toBe(20_000);
    });

    it('still counts a bookkeeping adjustment — 調帳 is a correction, not a wallet move', () => {
        setTx([row({ category: '調帳', amount: 5_000 })]);
        expect(renderHook(() => useAnnualCashFlow()).result.current.avgMonthlyExpense).toBe(5_000);
    });

    it('divides by the months that measured something, not every month with a row', () => {
        // Three months of real spending, plus an older month holding only a holding
        // purchase: dividing by four understated spending by a quarter.
        setTx([
            row({ amount: 20_000, transaction_date: monthsAgo(1) }),
            row({ amount: 20_000, transaction_date: monthsAgo(2) }),
            row({ amount: 20_000, transaction_date: monthsAgo(3) }),
            row({ category: 'Investment Purchase', amount: 500_000, transaction_date: monthsAgo(4) }),
        ]);
        const { result } = renderHook(() => useAnnualCashFlow());
        expect(result.current.monthsAveraged).toBe(3);
        expect(result.current.avgMonthlyExpense).toBe(20_000);
    });

    it('reports no data when nothing in the window was classifiable', () => {
        // A borrowed lump sum is the only row: a 0/0 "average" would otherwise be
        // preferred over the dashboard's own figures, which is how a real account
        // with one loan receipt got a NT$0 affordability ceiling.
        setTx([row({ type: 'income', category: 'Loan Receipt', amount: 1_160_000 })]);
        const { result } = renderHook(() => useAnnualCashFlow());
        expect(result.current.hasData).toBe(false);
        expect(result.current.avgMonthlyIncome).toBe(0);
        expect(result.current.avgMonthlyExpense).toBe(0);
    });

    it('ignores the incomplete current month', () => {
        setTx([
            row({ type: 'income', category: 'Salary', amount: 80_000, transaction_date: monthsAgo(0) }),
            row({ amount: 20_000, transaction_date: monthsAgo(0) }),
        ]);
        const { result } = renderHook(() => useAnnualCashFlow());
        expect(result.current.hasData).toBe(false);
        expect(result.current.avgMonthlyIncome).toBe(0);
    });
});
