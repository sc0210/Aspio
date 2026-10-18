import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within as _within,
} from '@testing-library/react';

// ─── Next.js / routing mocks ──────────────────────────────────────────────────
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
// Mutable so a test can open the page as if it had been clicked from a filtered list.
let mockSearch = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ id: 'test-transaction-id' }),
  useSearchParams: () => mockSearch,
}));

jest.mock('next/link', () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

// ─── React Query ──────────────────────────────────────────────────────────────
// jest.setup.js already stubs this module completely. A local factory REPLACES
// that stub rather than extending it, and it replaces it for the entire module
// graph — not just for the page. The page itself only calls useQueryClient, but
// it imports useCurrentUser → useAuthenticatedQuery → useQuery, so omitting
// useQuery here made every test in this file die on "useQuery is not a
// function". Anything added to the global stub needs mirroring here.
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    error: null,
    refetch: jest.fn(),
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: jest.fn(),
  }),
}));

// ─── Services ─────────────────────────────────────────────────────────────────
const mockGetTransactionById = jest.fn();
const mockUpdateTransaction = jest.fn();
jest.mock('@/services/transactionService', () => ({
  transactionService: {
    getTransactionById: (...a: unknown[]) => mockGetTransactionById(...a),
    updateTransaction: (...a: unknown[]) => mockUpdateTransaction(...a),
  },
}));

const mockGetPortfolio = jest.fn();
const mockUpdateHolding = jest.fn();
jest.mock('@/services/portfolioService', () => ({
  portfolioService: {
    getPortfolio: (...a: unknown[]) => mockGetPortfolio(...a),
    updateHolding: (...a: unknown[]) => mockUpdateHolding(...a),
  },
}));

// ─── Data-sync ────────────────────────────────────────────────────────────────
jest.mock('@/hooks/useDataSynchronization', () => ({
  QUERY_KEYS: {
    TRANSACTIONS: 'transactions',
    PORTFOLIO: 'portfolio',
    DASHBOARD: 'dashboard',
    OPTIMIZED_DASHBOARD: 'optimized_dashboard',
    WALLET_TRENDS: 'wallet_trends',
    TRANSACTION_STATS: 'transaction_stats',
    GOALS: 'goals',
    GOALS_SUMMARY: 'goals_summary',
    REBALANCING: 'rebalancing',
  },
  invalidateDashboardData: jest.fn(),
}));

// ─── UI / Context mocks ───────────────────────────────────────────────────────
const mockDemoTransactions: unknown[] = [];
jest.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ demoTransactions: mockDemoTransactions }),
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
  useModeAwareUI: () => ({ isDemo: false }),
}));
jest.mock('react-i18next', () => {
  // Hoisted into the factory so the identities below are created once, not per
  // render. The real useTranslation returns a stable `t`, and the page's load
  // effect lists `t` in its dependency array — handing back a fresh function
  // each render re-fires the effect, which calls setIsLoading(true) and
  // re-renders, forever. The spinner then never clears and every test that
  // waits for it times out at 5s.
  // Honour i18next's `t(key, defaultValue)` form. The page labels most fields
  // that way, so a key-only mock renders "transactions:form.typeLabel" where
  // the real app renders "Transaction Type" — assertions on visible copy then
  // fail against a string no user ever sees.
  const t = (key: string, fallback?: string) =>
    typeof fallback === 'string' ? fallback : key;
  const i18n = { changeLanguage: jest.fn() };
  const translation = { t, i18n };
  return {
    // i18next calls .use(initReactI18next) at import time; a mock without it
    // makes lib/i18n throw and the whole suite dies before any test runs.
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => translation,
  };
});

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: (...a: unknown[]) => mockToastSuccess(...a), error: (...a: unknown[]) => mockToastError(...a) },
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));
jest.mock('@/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));
jest.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    type,
    onClick,
    isLoading,
  }: {
    children: React.ReactNode;
    type?: string;
    onClick?: () => void;
    isLoading?: boolean;
  }) => (
    <button type={(type as 'button' | 'submit' | 'reset') || 'button'} onClick={onClick} disabled={isLoading}>
      {children}
    </button>
  ),
}));
jest.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <svg data-testid="arrow-left" />,
  CheckIcon: () => <svg data-testid="check-icon" />,
}));

// ─── Component under test ─────────────────────────────────────────────────────
import EditTransactionPage from '@/app/transactions/edit/[id]/page';

// ─── Test data ────────────────────────────────────────────────────────────────
const investTx = {
  id: 'test-transaction-id',
  type: 'expense',
  amount: 100000,
  currency: 'TWD',
  category: 'Investment Purchase',
  description: 'Buy 0050 ×100 @ 1,000.00 TWD',
  date: new Date('2026-04-29'),
  paymentMethod: 'bank_transfer',
  walletType: 'life',
  tags: [],
};

const expenseTx = {
  id: 'test-transaction-id',
  type: 'expense',
  amount: 250,
  currency: 'TWD',
  category: 'Dining',
  description: 'Lunch',
  date: new Date('2026-04-29'),
  paymentMethod: 'cash',
  walletType: 'life',
  tags: [],
};

// ─── Render helper ────────────────────────────────────────────────────────────
/**
 * Render the page and wait until the loading spinner disappears,
 * meaning all async state updates from loadTransaction() have been applied.
 */
async function renderAndLoad(tx: typeof investTx | typeof expenseTx) {
  mockGetTransactionById.mockResolvedValue({ success: true, data: tx });

  await act(async () => {
    render(<EditTransactionPage />);
    // Allow the microtask queue to drain (resolves the mockResolvedValue promise)
    await Promise.resolve();
  });

  // Wait until the spinner is gone (loading = false)
  await waitFor(
    () => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument(),
    { timeout: 3000 },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('EditTransactionPage — Loading State', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading spinner while transaction is fetching', () => {
    mockGetTransactionById.mockReturnValue(new Promise(() => {})); // never resolves
    render(<EditTransactionPage />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });
});

describe('EditTransactionPage — Investment Mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enters invest mode when category is Investment Purchase', async () => {
    await renderAndLoad(investTx);
    expect(screen.getByText(/Investment Purchase — Edit Asset Details/i)).toBeInTheDocument();
  });

  it('pre-populates symbol from description', async () => {
    await renderAndLoad(investTx);
    const symbolInput = screen.getByPlaceholderText(/e\.g\. 0050/i) as HTMLInputElement;
    expect(symbolInput.value).toBe('0050');
  });

  it('pre-populates quantity from description', async () => {
    await renderAndLoad(investTx);
    const qtyInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    expect(qtyInput.value).toBe('100');
  });

  it('pre-populates price from description (commas stripped)', async () => {
    await renderAndLoad(investTx);
    const priceInput = screen.getByPlaceholderText('100.00') as HTMLInputElement;
    expect(priceInput.value).toBe('1000.00');
  });

  it('displays the auto-calculated total (qty × price)', async () => {
    await renderAndLoad(investTx);
    // 100 × 1000 = 100,000.00
    expect(screen.getByText(/100,000\.00/)).toBeInTheDocument();
  });

  it('hides the standard Transaction Type toggle', async () => {
    await renderAndLoad(investTx);
    expect(screen.queryByText('Transaction Type')).not.toBeInTheDocument();
  });

  it('hides standard category grid', async () => {
    await renderAndLoad(investTx);
    expect(screen.queryByText(/^Category$/)).not.toBeInTheDocument();
  });

  it('shows "Update Investment Transaction" submit label', async () => {
    await renderAndLoad(investTx);
    expect(screen.getByText('Update Investment Transaction')).toBeInTheDocument();
  });

  it('recalculates total when qty is changed', async () => {
    await renderAndLoad(investTx);
    const qtyInput = screen.getByPlaceholderText('100');
    fireEvent.change(qtyInput, { target: { value: '200' } });
    // 200 × 1000 = 200,000.00
    await waitFor(() => expect(screen.getByText(/200,000\.00/)).toBeInTheDocument());
  });
});

describe('EditTransactionPage — Standard Expense Mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does NOT enter invest mode for a regular expense', async () => {
    await renderAndLoad(expenseTx);
    expect(screen.queryByText(/Investment Purchase — Edit Asset Details/i)).not.toBeInTheDocument();
  });

  it('shows Transaction Type toggle for a regular expense', async () => {
    await renderAndLoad(expenseTx);
    expect(screen.getByText('Transaction Type')).toBeInTheDocument();
  });

  it('shows "Update Transaction" submit label', async () => {
    await renderAndLoad(expenseTx);
    expect(screen.getByText('Update Transaction')).toBeInTheDocument();
  });
});

describe('EditTransactionPage — Invest Mode Validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows error when symbol is cleared', async () => {
    await renderAndLoad(investTx);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 0050/i), { target: { value: '' } });
    fireEvent.click(screen.getByText('Update Investment Transaction'));

    await waitFor(() => expect(screen.getByText('Enter a symbol')).toBeInTheDocument());
    expect(mockUpdateTransaction).not.toHaveBeenCalled();
  });

  it('shows error when quantity is set to 0', async () => {
    await renderAndLoad(investTx);

    fireEvent.change(screen.getByPlaceholderText('100'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Update Investment Transaction'));

    await waitFor(() => expect(screen.getByText('Enter quantity')).toBeInTheDocument());
    expect(mockUpdateTransaction).not.toHaveBeenCalled();
  });

  it('shows error when price is set to 0', async () => {
    await renderAndLoad(investTx);

    fireEvent.change(screen.getByPlaceholderText('100.00'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Update Investment Transaction'));

    await waitFor(() => expect(screen.getByText('Enter price per unit')).toBeInTheDocument());
    expect(mockUpdateTransaction).not.toHaveBeenCalled();
  });
});

describe('EditTransactionPage — Invest Submit: holding found', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateTransaction.mockResolvedValue({ success: true, data: {} });
    mockGetPortfolio.mockResolvedValue({
      success: true,
      data: {
        holdings: [{ id: 'holding-1', symbol: '0050', averageCost: 1000, quantity: 100 }],
      },
    });
    mockUpdateHolding.mockResolvedValue({ success: true, data: {} });
  });

  it('calls updateTransaction with canonical description and correct amount', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalled());

    const [, payload] = mockUpdateTransaction.mock.calls[0];
    expect(payload.description).toBe('Buy 0050 ×100 @ 1,000.00 TWD');
    expect(payload.amount).toBeCloseTo(100000);
    expect(payload.type).toBe('expense');
    expect(payload.category).toBe('Investment Purchase');
  });

  it('syncs the matching portfolio holding', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockUpdateHolding).toHaveBeenCalled());
    expect(mockUpdateHolding).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'holding-1', averageCost: 1000, quantity: 100 }),
    );
  });

  it('navigates to /transactions after saving', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/transactions'));
  });
});

describe('EditTransactionPage — coming back to the list you left', () => {
  // Editing is a separate page, so saving used to push a bare '/transactions' and the
  // list remounted with its filters reset: narrow to one category, correct a row, land
  // on an unfiltered list. The list now keeps its filters in the URL and hands that URL
  // to the edit link, which pushes it back.
  afterEach(() => {
    mockSearch = new URLSearchParams();
  });

  it('returns to the filtered view the edit was opened from', async () => {
    mockSearch = new URLSearchParams({
      returnTo: '/transactions?type=expense&category=Dining&q=coffee',
    });
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/transactions?type=expense&category=Dining&q=coffee',
      ),
    );
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a scheme-relative host', '//evil.example/phish'],
    ['a path outside the list', '/settings'],
    ['a backslash trick', '/transactions\\@evil.example'],
    ['malformed encoding', '%E0%A4%A'],
  ])('refuses %s and lands on the plain list', async (_label, hostile) => {
    // returnTo is a user-supplied string that becomes a navigation, so a crafted link
    // must not be able to turn "save" into a redirect off the site or deeper into the
    // app. The save itself still has to go through.
    mockSearch = new URLSearchParams({ returnTo: hostile });
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/transactions'));
  });
});

describe('EditTransactionPage — Invest Submit: holding deleted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateTransaction.mockResolvedValue({ success: true, data: {} });
    // Portfolio returns no matching holding
    mockGetPortfolio.mockResolvedValue({ success: true, data: { holdings: [] } });
  });

  it('updates the transaction even when holding is not found', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalled());
    expect(mockUpdateHolding).not.toHaveBeenCalled();
  });

  it('navigates to /transactions even when holding is missing', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/transactions'));
  });
});

describe('EditTransactionPage — Invest Submit: portfolio API failure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateTransaction.mockResolvedValue({ success: true, data: {} });
    mockGetPortfolio.mockRejectedValue(new Error('Network error'));
  });

  it('still navigates after portfolio sync failure', async () => {
    await renderAndLoad(investTx);

    await act(async () => {
      fireEvent.click(screen.getByText('Update Investment Transaction'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/transactions'));
    expect(mockUpdateHolding).not.toHaveBeenCalled();
  });
});
