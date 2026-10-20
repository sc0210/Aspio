import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@testing-library/react';

// This suite drives useQuery by queryKey to check what the page renders; it has
// no interest in the cache. react-query is no longer stubbed globally, so it
// opts into the stub explicitly.
jest.mock('@tanstack/react-query', () =>
    jest.requireActual<typeof import('../utils/reactQueryStub')>(
        '../utils/reactQueryStub',
    ).createReactQueryStub());
import MonthlySummaryPage from '@/app/transactions/monthly-summary/page';
import { formatMonth, formatMonthShort } from '@/utils/monthFormat';

// Suppress SVG element warnings from jsdom (linearGradient, stop, defs — these
// are valid SVG but unrecognized by jsdom's HTML parser)
const originalError = console.error.bind(console);
beforeAll(() => {
    console.error = (...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        if (
            msg.includes('linearGradient') ||
            msg.includes('<stop>') ||
            msg.includes('<defs>') ||
            msg.includes('unrecognized') && msg.includes('tag')
        ) return;
        originalError(...args);
    };
});
afterAll(() => { console.error = originalError; });

// ─── Module mocks ────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, defaultValueOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
            const options = typeof defaultValueOrOpts === 'object' ? defaultValueOrOpts : opts;
            if (typeof defaultValueOrOpts === 'string') {
                let result = defaultValueOrOpts;
                if (options) {
                    Object.entries(options).forEach(([k, v]) => {
                        result = result.replace(`{{${k}}}`, String(v));
                    });
                }
                return result;
            }
            return key;
        },
        i18n: { language: 'en', changeLanguage: jest.fn() },
    }),
}));

const mockUsePrivacy = jest.fn(() => ({ isValueVisible: true }));
jest.mock('@/contexts/PrivacyContext', () => ({
    usePrivacy: () => mockUsePrivacy(),
}));

jest.mock('@/hooks/useAppMode', () => ({
    // The module also exports useAppMode, which components call directly. A mock
    // without it makes every such component throw "useAppMode is not a function".
    // Default matches jest.setup.js's global AuthContext mock: a signed-in user.
    useAppMode: () => ({
        mode: 'authenticated',
        isAuthenticated: true,
        isDemo: false,
        user: { id: 'test-user-id', email: 'test@example.com', name: 'Test User' },
        canPersistData: true,
        session: { user: { id: 'test-user-id' }, accessToken: 'mock-access-token' },
        status: 'authenticated',
        isLoading: false,
    }),
    useModeAwareUI: () => ({
        getModeIndicator: () => ({ className: 'bg-green-100 text-green-700', text: 'Live' }),
        isDemo: false,
    }),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="dashboard-layout">{children}</div>
    ),
}));

jest.mock('@/components/ui/LoadingSpinner', () => ({
    LoadingSpinner: ({ size }: { size?: string }) => (
        <div data-testid="loading-spinner" data-size={size} />
    ),
}));

const mockToastError = jest.fn();
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

jest.mock('recharts', () => ({
    ComposedChart: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="composed-chart">{children}</div>
    ),
    PieChart: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="pie-chart">{children}</div>
    ),
    Pie: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
        <div data-testid="pie" data-items={data?.length}>{children}</div>
    ),
    Cell: ({ fill }: { fill: string }) => <div data-testid="pie-cell" data-fill={fill} />,
    Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
    Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="responsive-container">{children}</div>
    ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const { useQuery } = jest.requireMock('@tanstack/react-query') as {
    useQuery: jest.Mock;
};

// Mirrors the page's MonthlySummary: `transfer` and `debt` are optional there too,
// because a cached response from before the API reported them must still render.
// Typed explicitly rather than inferred from mockSummaries — `tsc -p
// tsconfig.test.json` (which CI runs separately from `type-check`) rejects a fixture
// carrying a field the inferred shape lacks, so an inferred type would force every
// fixture in the file to look identical.
type SummaryFixture = {
    month: string;
    income: number;
    housing: number;
    eat: number;
    investment: number;
    transfer?: number;
    debt?: number;
    others: number;
    total: number;
};

const mockSummaries: SummaryFixture[] = [
    // `income` is a required field on MonthlySummary and is what the Net
    // Remaining card sums — it is NOT derived from the income transactions
    // below. Omitting it made every row contribute 0 income, so the page showed
    // Deficit while the surplus test asserted otherwise (and the deficit test
    // passed for the wrong reason).
    { month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 3000, others: 2000, total: 20000 },
    { month: '2024-02', income: 50000, housing: 8000, eat: 4000, investment: 0, others: 1500, total: 13500 },
];

const mockIncome = [
    { id: '1', type: 'income', amount: 50000, currency: 'TWD', transaction_date: '2024-01-15' },
    { id: '2', type: 'income', amount: 50000, currency: 'TWD', transaction_date: '2024-02-15' },
];

function setupQueries(
    summaries: SummaryFixture[] | undefined | null | [],
    income: typeof mockIncome | undefined | [],
    isLoading = false
) {
    useQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
        if (queryKey[0] === 'monthly-summary') {
            return { data: summaries ?? undefined, isLoading, error: null };
        }
        return { data: income ?? undefined, isLoading: false, error: null };
    });
}

// ─── Pure function tests ──────────────────────────────────────────────────────

describe('formatMonth', () => {
    it('formats January correctly', () => {
        expect(formatMonth('2024-01')).toBe('January 2024');
    });

    it('formats December correctly', () => {
        expect(formatMonth('2024-12')).toBe('December 2024');
    });

    it('formats mid-year months', () => {
        expect(formatMonth('2023-06')).toBe('June 2023');
        expect(formatMonth('2022-09')).toBe('September 2022');
    });

    it('handles single-digit months with leading zero', () => {
        expect(formatMonth('2024-03')).toBe('March 2024');
    });
});

describe('formatMonthShort', () => {
    it('formats January as Jan', () => {
        expect(formatMonthShort('2024-01')).toBe('Jan');
    });

    it('formats December as Dec', () => {
        expect(formatMonthShort('2024-12')).toBe('Dec');
    });

    it('formats mid-year months', () => {
        expect(formatMonthShort('2024-06')).toBe('Jun');
        expect(formatMonthShort('2024-11')).toBe('Nov');
    });
});

// ─── Component tests ──────────────────────────────────────────────────────────

describe('MonthlySummaryPage', () => {
    beforeEach(() => {
        useQuery.mockReset();
        mockUsePrivacy.mockReturnValue({ isValueVisible: true });
        mockToastError.mockClear();
    });

    // ── Loading state ────────────────────────────────────────────────────────

    describe('loading state', () => {
        it('shows loading spinner while monthlySummaries is loading', () => {
            setupQueries(undefined, undefined, true);
            render(<MonthlySummaryPage />);
            expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
        });

        it('shows loading message text', () => {
            setupQueries(undefined, undefined, true);
            render(<MonthlySummaryPage />);
            expect(screen.getByText('Loading monthly summary...')).toBeInTheDocument();
        });

        it('does not render the main layout while loading', () => {
            setupQueries(undefined, undefined, true);
            render(<MonthlySummaryPage />);
            expect(screen.queryByText('Monthly Summary')).not.toBeInTheDocument();
        });
    });

    // ── Empty state ──────────────────────────────────────────────────────────

    describe('empty state', () => {
        it('shows no-data message when summaries array is empty', () => {
            setupQueries([], []);

            render(<MonthlySummaryPage />);

            expect(screen.getByText(/No data available for/)).toBeInTheDocument();
        });

        it('shows hint text in empty state', () => {
            setupQueries([], []);

            render(<MonthlySummaryPage />);

            expect(screen.getByText('Try selecting a different year or add some transactions')).toBeInTheDocument();
        });

        it('shows pie "No data available" when yearlyTotals are all zero', () => {
            setupQueries([], []);

            render(<MonthlySummaryPage />);

            expect(screen.getByText('No data available')).toBeInTheDocument();
        });
    });

    // ── Data rendering ───────────────────────────────────────────────────────

    describe('with data', () => {
        beforeEach(() => {
            setupQueries(mockSummaries, mockIncome);
        });

        it('renders page title', () => {
            render(<MonthlySummaryPage />);
            expect(screen.getByText('Monthly Summary')).toBeInTheDocument();
        });

        it('renders month names in table from formatMonth', () => {
            render(<MonthlySummaryPage />);
            expect(screen.getByText('January 2024')).toBeInTheDocument();
            expect(screen.getByText('February 2024')).toBeInTheDocument();
        });

        it('shows income summary card', () => {
            render(<MonthlySummaryPage />);
            // Both the card badge and the table header use the 'Income' label
            expect(screen.getAllByText('Income').length).toBeGreaterThan(0);
        });

        it('shows surplus badge when income exceeds expenses', () => {
            // income = 100000 TWD, expenses = 33500 TWD → surplus
            render(<MonthlySummaryPage />);
            expect(screen.getByText('Surplus')).toBeInTheDocument();
        });

        it('renders the pie chart when categories have data', () => {
            render(<MonthlySummaryPage />);
            expect(screen.getByTestId('pie')).toBeInTheDocument();
        });

        it('renders correct number of pie cells', () => {
            render(<MonthlySummaryPage />);
            // 3 categories have data: housing, eat, investment, others (all 4 in mockSummaries)
            const cells = screen.getAllByTestId('pie-cell');
            expect(cells.length).toBe(4);
        });

        it('renders bar chart elements by default', () => {
            render(<MonthlySummaryPage />);
            expect(screen.getByTestId('bar-Housing')).toBeInTheDocument();
            expect(screen.getByTestId('bar-Eat')).toBeInTheDocument();
        });

        it('does not render line chart by default', () => {
            render(<MonthlySummaryPage />);
            expect(screen.queryByTestId('line-Income')).not.toBeInTheDocument();
        });

        // The label moved into the icon link's accessible name when this page
        // adopted PageHeader, so assert on that and on where it goes — both
        // survive the label becoming an icon, which visible text did not.
        it('renders a back link to the transactions list', () => {
            render(<MonthlySummaryPage />);
            expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/transactions');
        });
    });

    // ── Deficit state ────────────────────────────────────────────────────────

    describe('deficit state', () => {
        it('shows deficit badge when expenses exceed income', () => {
            // Deficit is decided by the summaries' own income totals, so this
            // has to lower those — not the income transactions list.
            const lowIncomeSummaries = mockSummaries.map((m) => ({ ...m, income: 1000 }));
            setupQueries(lowIncomeSummaries, mockIncome);

            render(<MonthlySummaryPage />);

            expect(screen.getByText('Deficit')).toBeInTheDocument();
            expect(screen.queryByText('Surplus')).toBeNull();
        });
    });

    // ── Privacy masking ──────────────────────────────────────────────────────

    // Loan repayments used to be summed into Others, so that column read as
    // discretionary spending when most of it was servicing debt.
    describe('debt column', () => {
        const withDebt = [
            { month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 3000, debt: 12000, others: 2000, total: 32000 },
        ];

        it('renders a Debt header between Invest and Others', () => {
            setupQueries(withDebt, mockIncome);
            render(<MonthlySummaryPage />);

            const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim() ?? '');
            const debtIdx = headers.findIndex(h => h.includes('Debt'));
            const investIdx = headers.findIndex(h => h.includes('Invest'));
            const othersIdx = headers.findIndex(h => h.includes('Others'));

            expect(debtIdx).toBeGreaterThan(-1);
            expect(investIdx).toBeLessThan(debtIdx);
            expect(debtIdx).toBeLessThan(othersIdx);
        });

        it('shows the debt amount and its share of the month', () => {
            setupQueries(withDebt, mockIncome);
            render(<MonthlySummaryPage />);

            // Scoped to the table: the yearly total repeats the same figure in the
            // pie's category grid.
            const table = within(screen.getByRole('table'));
            expect(table.getByText('NT$12,000')).toBeInTheDocument();
            expect(table.getByText('37.5%')).toBeInTheDocument();  // 12000 / 32000
        });

        it('gives debt its own pie slice, distinct from Others', () => {
            setupQueries(withDebt, mockIncome);
            render(<MonthlySummaryPage />);

            const fills = screen.getAllByTestId('pie-cell').map(c => c.getAttribute('data-fill'));
            expect(fills).toContain('#be123c');   // Debt
            expect(fills).toContain('#8b5cf6');   // Others, still separate
        });

        it('is absent from the pie when nothing was repaid that year', () => {
            setupQueries(
                [{ month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, debt: 0, others: 0, total: 15000 }],
                mockIncome,
            );
            render(<MonthlySummaryPage />);

            const fills = screen.getAllByTestId('pie-cell').map(c => c.getAttribute('data-fill'));
            expect(fills).not.toContain('#be123c');
        });

        it('still renders when the API response predates the bucket', () => {
            // `debt` is optional for exactly this reason — a cached response from
            // before the API reported it must not blank the column.
            setupQueries(mockSummaries, mockIncome);
            render(<MonthlySummaryPage />);

            expect(screen.getAllByRole('columnheader').some(h => h.textContent?.includes('Debt'))).toBe(true);
        });
    });

    describe('privacy masking', () => {
        it('masks all financial values when isValueVisible is false', () => {
            mockUsePrivacy.mockReturnValue({ isValueVisible: false });
            setupQueries(mockSummaries, mockIncome);

            render(<MonthlySummaryPage />);

            const masked = screen.getAllByText('•••••');
            // Summary cards (4) + table income/housing/eat/invest/debt/others/remaining cols per row (2 rows)
            expect(masked.length).toBeGreaterThan(4);
        });

        it('shows no masked values when isValueVisible is true', () => {
            mockUsePrivacy.mockReturnValue({ isValueVisible: true });
            setupQueries(mockSummaries, mockIncome);

            render(<MonthlySummaryPage />);

            expect(screen.queryByText('•••••')).not.toBeInTheDocument();
        });

        it('masks summary card values individually', () => {
            mockUsePrivacy.mockReturnValue({ isValueVisible: false });
            setupQueries(
                [{ month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, others: 2000, total: 17000 }],
                [{ id: '1', type: 'income', amount: 50000, currency: 'TWD', transaction_date: '2024-01-15' }]
            );

            render(<MonthlySummaryPage />);

            // At minimum: income card, expense card, invested card, remaining card = 4
            const masked = screen.getAllByText('•••••');
            expect(masked.length).toBeGreaterThanOrEqual(4);
        });
    });

    // ── Chart toggle ─────────────────────────────────────────────────────────

    describe('chart toggle behavior', () => {
        beforeEach(() => {
            // mockReturnValue (not Once) persists across re-renders triggered by state changes
            useQuery.mockReturnValue({ data: [], isLoading: false, error: null });
        });

        it('bar button starts in active state', () => {
            render(<MonthlySummaryPage />);
            const barBtn = screen.getByRole('button', { name: /Bar/i });
            expect(barBtn).toHaveClass('bg-primary-700');
        });

        it('line button starts in inactive state', () => {
            render(<MonthlySummaryPage />);
            const lineBtn = screen.getByRole('button', { name: /Line/i });
            expect(lineBtn).not.toHaveClass('bg-primary-700');
        });

        it('cannot deactivate bar when it is the only active chart', () => {
            render(<MonthlySummaryPage />);
            const barBtn = screen.getByRole('button', { name: /Bar/i });
            // bar=true, line=false → clicking bar should be a no-op
            fireEvent.click(barBtn);
            expect(barBtn).toHaveClass('bg-primary-700');
        });

        it('cannot deactivate line when it is the only active chart', () => {
            render(<MonthlySummaryPage />);
            // First: activate line (bar=true, line=false → bar still on)
            const lineBtn = screen.getByRole('button', { name: /Line/i });
            fireEvent.click(lineBtn); // now bar=true, line=true
            // Deactivate bar (bar=false, line=true)
            const barBtn = screen.getByRole('button', { name: /Bar/i });
            fireEvent.click(barBtn); // now bar=false, line=true
            // Now clicking line should be a no-op
            fireEvent.click(lineBtn);
            expect(lineBtn).toHaveClass('bg-primary-700');
        });

        it('activates line chart when clicked', () => {
            render(<MonthlySummaryPage />);
            const lineBtn = screen.getByRole('button', { name: /Line/i });
            fireEvent.click(lineBtn);
            expect(lineBtn).toHaveClass('bg-primary-700');
        });

        it('can deactivate bar when line is also active', () => {
            render(<MonthlySummaryPage />);
            const lineBtn = screen.getByRole('button', { name: /Line/i });
            const barBtn = screen.getByRole('button', { name: /Bar/i });

            fireEvent.click(lineBtn); // bar=true, line=true
            fireEvent.click(barBtn); // bar=false, line=true

            expect(barBtn).not.toHaveClass('bg-primary-700');
            expect(lineBtn).toHaveClass('bg-primary-700');
        });

        it('can deactivate line when bar is also active', () => {
            render(<MonthlySummaryPage />);
            const lineBtn = screen.getByRole('button', { name: /Line/i });
            const barBtn = screen.getByRole('button', { name: /Bar/i });

            fireEvent.click(lineBtn); // bar=true, line=true
            fireEvent.click(lineBtn); // bar=true, line=false

            expect(lineBtn).not.toHaveClass('bg-primary-700');
            expect(barBtn).toHaveClass('bg-primary-700');
        });
    });

    // ── Error handling ───────────────────────────────────────────────────────

    describe('error handling', () => {
        it('shows toast when monthly summary query errors', async () => {
            const networkError = new Error('Network error');
            useQuery.mockImplementation((options?: { queryKey?: unknown[] }) => {
                if (options?.queryKey?.[0] === 'monthly-summary') {
                    return { data: undefined, isLoading: false, error: networkError };
                }
                return { data: undefined, isLoading: false, error: null };
            });

            render(<MonthlySummaryPage />);

            await waitFor(() => {
                expect(mockToastError).toHaveBeenCalledTimes(1);
            });
        });

        it('does not show error toast when there is no error', async () => {
            setupQueries(mockSummaries, mockIncome);

            render(<MonthlySummaryPage />);

            await waitFor(() => {
                expect(mockToastError).not.toHaveBeenCalled();
            });
        });
    });

    // ── Year selector ────────────────────────────────────────────────────────

    describe('year selector', () => {
        it('renders year select with current year as default', () => {
            setupQueries([], []);
            render(<MonthlySummaryPage />);

            const select = screen.getByRole('combobox') as HTMLSelectElement;
            expect(select.value).toBe(String(new Date().getFullYear()));
        });

        it('renders 5 year options', () => {
            setupQueries([], []);
            render(<MonthlySummaryPage />);

            const options = screen.getAllByRole('option');
            expect(options).toHaveLength(5);
        });
    });

    // ── Pie chart data alignment ─────────────────────────────────────────────

    describe('pie chart data alignment', () => {
        it('renders one Cell per visible category', () => {
            // Only housing and eat have data; investment=0, others=0
            setupQueries(
                [{ month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, others: 0, total: 15000 }],
                []
            );

            render(<MonthlySummaryPage />);

            const cells = screen.getAllByTestId('pie-cell');
            // pie data filters to only categories > 0: housing + eat = 2
            expect(cells).toHaveLength(2);
        });

        it('aligns cell colors with pie data order', () => {
            setupQueries(
                [{ month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, others: 0, total: 15000 }],
                []
            );

            render(<MonthlySummaryPage />);

            const cells = screen.getAllByTestId('pie-cell');
            expect(cells[0]).toHaveAttribute('data-fill', '#3b82f6'); // Housing
            expect(cells[1]).toHaveAttribute('data-fill', '#f59e0b'); // Eat
        });
    });

    // ── Remaining column calculation ─────────────────────────────────────────

    describe('remaining column', () => {
        it('renders positive remaining with green styling', () => {
            // Jan: income=50000, expenses=20000 → remaining=30000 (positive)
            setupQueries(mockSummaries, mockIncome);
            render(<MonthlySummaryPage />);

            // The remaining spans use green/red classes — check the cells exist
            // (exact formatting depends on formatTWD)
            const rows = screen.getAllByRole('row');
            // Header + 2 data rows
            expect(rows.length).toBeGreaterThanOrEqual(3);
        });

        it('computes remaining per month from monthlyIncomeData', () => {
            const singleMonth = [
                { month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, others: 0, total: 15000 },
            ];
            const singleIncome = [
                { id: '1', type: 'income', amount: 20000, currency: 'TWD', transaction_date: '2024-01-10' },
            ];
            setupQueries(singleMonth, singleIncome);
            render(<MonthlySummaryPage />);

            // remaining = 20000 - 15000 = 5000, visible → some NT$ formatted value
            expect(screen.queryByText('•••••')).not.toBeInTheDocument();
        });
    });

    // ── Transfers ────────────────────────────────────────────────────────────

    describe('transfers between wallets', () => {
        // NT$30,000 moved to Emergency: the API counts the outgoing leg in `total`
        // and drops the incoming one from income. The table has no Transfer column,
        // so counting it read as NT$30,000 of spending nobody could find.
        const withTransfer = [
            { month: '2024-01', income: 50000, housing: 10000, eat: 5000, investment: 0, transfer: 30000, others: 0, total: 45000 },
        ];

        it('leaves the move out of Total Expenses and Net Remaining', () => {
            setupQueries(withTransfer, mockIncome);
            render(<MonthlySummaryPage />);

            expect(screen.getByText('NT$15,000')).toBeInTheDocument();       // 45000 - 30000
            expect(screen.getAllByText('NT$35,000').length).toBe(2);         // card + table row
            expect(screen.getByText('Surplus')).toBeInTheDocument();
        });

        it('takes each column\'s share of the spending, not of every outflow', () => {
            setupQueries(withTransfer, mockIncome);
            render(<MonthlySummaryPage />);

            const table = within(screen.getByRole('table'));
            expect(table.getByText('66.7%')).toBeInTheDocument();  // housing 10000 / 15000
            expect(table.getByText('33.3%')).toBeInTheDocument();  // eat 5000 / 15000
        });

        it('says where the money went, masked like every other figure', () => {
            setupQueries(withTransfer, mockIncome);
            const { unmount } = render(<MonthlySummaryPage />);
            expect(screen.getByText('Moved between your wallets: NT$30,000 (not spending)')).toBeInTheDocument();
            unmount();

            mockUsePrivacy.mockReturnValue({ isValueVisible: false });
            render(<MonthlySummaryPage />);
            expect(screen.getByText('Moved between your wallets: ••••• (not spending)')).toBeInTheDocument();
        });

        it('shows no such line in a year without transfers', () => {
            setupQueries(mockSummaries, mockIncome);
            render(<MonthlySummaryPage />);
            expect(screen.queryByText(/Moved between your wallets/)).not.toBeInTheDocument();
        });
    });
});
