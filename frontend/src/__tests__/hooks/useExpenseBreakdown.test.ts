import { renderHook } from '@testing-library/react';
import { useExpenseBreakdown } from '@/hooks/useExpenseBreakdown';

const mockUseTransactions = jest.fn();
jest.mock('@/hooks/useTransactions', () => ({
    useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));
jest.mock('@/hooks/useAppMode', () => ({
    useAppMode: () => ({ isDemo: false, session: { user: { email: 'tester@example.com' } } }),
}));
// react-query is stubbed so the loans query can be driven from here: its idle
// useQuery means no loans, and `setLoans` below hands back a list when a test wants
// one.
jest.mock('@tanstack/react-query', () =>
    jest.requireActual<typeof import('../utils/reactQueryStub')>(
        '../utils/reactQueryStub',
    ).createReactQueryStub());

interface Loan {
    id: string;
    status: string;
    current_balance: number;
    interest_rate: number;
    currency?: string;
}

const setLoans = (loans: Loan[]) => {
    const { useQuery } = jest.requireMock('@tanstack/react-query');
    useQuery.mockReturnValue({ data: { data: loans }, isLoading: false });
};

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
    loanId?: string;
}

const row = (o: Partial<Row>): Row => ({
    transaction_date: monthsAgo(1),
    amount: 1000,
    currency: 'TWD',
    type: 'expense',
    category: 'Dining',
    ...o,
});

const setTx = (transactions: Row[]) =>
    mockUseTransactions.mockReturnValue({ transactions, isLoading: false });

const bucket = (r: ReturnType<typeof useExpenseBreakdown>, key: string) =>
    r.categories.find((c) => c.key === key)?.monthlyAvg ?? 0;

describe('useExpenseBreakdown', () => {
    beforeEach(() => {
        mockUseTransactions.mockReset();
        setLoans([]);
    });

    it('groups spending into buckets and averages over the months with data', () => {
        setTx([
            row({ category: 'Dining', amount: 6_000 }),
            row({ category: 'Transportation', amount: 2_000 }),
            row({ category: 'Housing', amount: 20_000 }),
            row({ category: 'Shopping', amount: 4_000 }),
            row({ type: 'income', category: 'Salary', amount: 80_000 }),
        ]);
        const { result } = renderHook(() => useExpenseBreakdown());
        expect(result.current.monthsAveraged).toBe(1);
        expect(bucket(result.current, 'food')).toBe(6_000);
        expect(bucket(result.current, 'transport')).toBe(2_000);
        expect(bucket(result.current, 'housing')).toBe(20_000);
        expect(bucket(result.current, 'other')).toBe(4_000);
        expect(result.current.avgMonthlyIncome).toBe(80_000);
    });

    it('keeps both legs of a wallet transfer out of the buckets and the income average', () => {
        const spendOnly = [
            row({ category: 'Dining', amount: 6_000 }),
            row({ type: 'income', category: 'Salary', amount: 80_000 }),
        ];
        setTx(spendOnly);
        const plain = renderHook(() => useExpenseBreakdown()).result.current;

        setTx([
            ...spendOnly,
            row({ category: 'Transfer', amount: 190_000, transferGroupId: 'grp-1' }),
            row({ type: 'income', category: 'Transfer', amount: 190_000, transferGroupId: 'grp-1' }),
        ]);
        const withTransfer = renderHook(() => useExpenseBreakdown()).result.current;

        expect(bucket(withTransfer, 'other')).toBe(bucket(plain, 'other'));
        expect(withTransfer.totalMonthlyExpense).toBe(plain.totalMonthlyExpense);
        expect(withTransfer.avgMonthlyIncome).toBe(plain.avgMonthlyIncome);
    });

    it('excludes a transfer leg written before transfer_group_id existed', () => {
        setTx([
            row({ category: 'Dining', amount: 6_000 }),
            row({ category: 'Transfer', amount: 190_000 }),
        ]);
        const { result } = renderHook(() => useExpenseBreakdown());
        expect(bucket(result.current, 'other')).toBe(0);
        expect(result.current.totalMonthlyExpense).toBe(6_000);
    });

    it('excludes investment purchases — money moved into investments is saving', () => {
        setTx([
            row({ category: 'Dining', amount: 6_000 }),
            row({ category: 'Investment Purchase', amount: 500_000 }),
        ]);
        expect(renderHook(() => useExpenseBreakdown()).result.current.totalMonthlyExpense).toBe(6_000);
    });
});

describe('useExpenseBreakdown — debt interest', () => {
    const loan: Loan = {
        id: 'loan-1',
        status: 'active',
        current_balance: 2_400_000,
        interest_rate: 5,
    };
    // 2,400,000 × 5% ÷ 12
    const modelledInterest = 10_000;

    beforeEach(() => mockUseTransactions.mockReset());

    it('models the interest on a loan the user does not record payments for', () => {
        setLoans([loan]);
        setTx([row({ category: 'Dining', amount: 6_000 })]);

        const { result } = renderHook(() => useExpenseBreakdown());
        expect(bucket(result.current, 'debtInterest')).toBe(modelledInterest);
        expect(result.current.totalMonthlyExpense).toBe(6_000 + modelledInterest);
    });

    it('does not also model interest the recorded repayments already contain', () => {
        // A repayment is a real expense row, interest and all — charging the modelled
        // interest on top billed the same money twice.
        setLoans([loan]);
        setTx([
            row({ category: 'Dining', amount: 6_000 }),
            row({ category: 'Loan Payment', amount: 25_000, loanId: 'loan-1' }),
        ]);

        const { result } = renderHook(() => useExpenseBreakdown());
        expect(bucket(result.current, 'debtInterest')).toBe(0);
        expect(bucket(result.current, 'other')).toBe(25_000);
        expect(result.current.totalMonthlyExpense).toBe(31_000);
    });

    it('still models the loans that are not being recorded', () => {
        const other: Loan = { ...loan, id: 'loan-2', current_balance: 1_200_000, interest_rate: 6 };
        setLoans([loan, other]);
        setTx([row({ category: 'Loan Payment', amount: 25_000, loanId: 'loan-1' })]);

        // Only loan-2 is modelled: 1,200,000 × 6% ÷ 12.
        expect(bucket(renderHook(() => useExpenseBreakdown()).result.current, 'debtInterest')).toBe(6_000);
    });

    it('ignores a loan that is no longer active', () => {
        setLoans([{ ...loan, status: 'paid_off' }]);
        setTx([row({ category: 'Dining', amount: 6_000 })]);
        expect(bucket(renderHook(() => useExpenseBreakdown()).result.current, 'debtInterest')).toBe(0);
    });
});
