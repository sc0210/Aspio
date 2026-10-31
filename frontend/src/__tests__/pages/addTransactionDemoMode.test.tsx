import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddTransactionPage from '@/app/transactions/add/page';
import { useDemo } from '@/contexts/DemoContext';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { transactionService } from '@/services/transactionService';
import toast from 'react-hot-toast';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/transactions/add',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: jest.fn(),
}));

// A child reads useAuthContext, which throws unless wrapped in
// AuthContextProvider. Mocking it is lighter than standing up the provider (and
// with it NextAuth's SessionProvider) just to render this page in demo mode.
jest.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    mode: 'demo' as const,
    isAuthenticated: false,
    isDemo: true,
    user: null,
    canPersistData: false,
    session: null,
    status: 'unauthenticated' as const,
  }),
}));

// The factory replaces the WHOLE module. The page itself only calls
// useModeAwareUI, but child components call useAppMode — and a missing entry
// surfaces as "useAppMode is not a function" pointing at the child rather than
// at this mock. These tests are all demo-mode, so return a demo state.
jest.mock('@/hooks/useAppMode', () => ({
  useModeAwareUI: jest.fn(),
  useAppMode: () => ({
    mode: 'demo' as const,
    isAuthenticated: false,
    isDemo: true,
    user: null,
    canPersistData: false,
    session: null,
    status: 'unauthenticated' as const,
    isLoading: false,
  }),
}));

jest.mock('@/services/transactionService', () => ({
  transactionService: {
    createTransaction: jest.fn(),
    createTransfer: jest.fn(),
  },
}));

jest.mock('@/services/portfolioService', () => ({
  portfolioService: { getPortfolio: jest.fn().mockResolvedValue({ success: true, data: { holdings: [] } }) },
}));

jest.mock('@/services/loanService', () => ({
  loanService: { getLoans: jest.fn().mockResolvedValue({ success: true, data: [] }) },
}));

// Whole-module mock again: children run useQuery/useMutation via the app's data
// hooks, so those have to exist here too. Idle stubs are enough — this suite is
// about the demo write path, not about fetching.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn(), cancelQueries: jest.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, isError: false }),
}));

jest.mock('@/hooks/useDataSynchronization', () => ({
  QUERY_KEYS: { TRANSACTIONS: 'transactions', PORTFOLIO: 'portfolio' },
  invalidateDashboardData: jest.fn(),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

// t() must honour the inline default, as i18next does. The page renders
// t('transactions:form.descriptionPlaceholder', "What's this for?"), so a
// key-echoing stub makes every by-text/by-placeholder query miss.
jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, d?: unknown) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && 'defaultValue' in (d as Record<string, unknown>)) {
        return (d as { defaultValue: string }).defaultValue;
      }
      return k;
    },
  }),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/utils/formatters', () => ({ localDateString: () => '2026-05-23' }));

const mockUseDemo = useDemo as jest.Mock;
const mockUseModeAwareUI = useModeAwareUI as jest.Mock;
const mockToast = toast as unknown as { success: jest.Mock; error: jest.Mock };

function setupDemoMode(isDemo = true) {
  const addDemoTransaction = jest.fn();
  mockUseDemo.mockReturnValue({ addDemoTransaction, isDemoMode: isDemo });
  mockUseModeAwareUI.mockReturnValue({ isDemo, getModeMessage: () => '', getModeIndicator: () => ({}) });
  return { addDemoTransaction };
}

async function fillAndSubmitExpenseForm(user: ReturnType<typeof userEvent.setup>) {
  // Amount — use userEvent for reliable number input handling
  const amountInput = screen.getAllByPlaceholderText('0')[0];
  await user.clear(amountInput);
  await user.type(amountInput, '250');
  // Description
  const descInput = screen.getByPlaceholderText("What's this for?");
  await user.clear(descInput);
  await user.type(descInput, 'Coffee');
  // Category — click the button whose accessible name includes 'Dining'
  await user.click(screen.getByRole('button', { name: /Dining/i }));
  // Submit
  await user.click(screen.getByRole('button', { name: /Add Transaction/i }));
}

describe('AddTransactionPage — demo mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls addDemoTransaction instead of the real API for income/expense', async () => {
    const user = userEvent.setup();
    const { addDemoTransaction } = setupDemoMode(true);
    render(<AddTransactionPage />);

    await fillAndSubmitExpenseForm(user);

    await waitFor(() => {
      expect(addDemoTransaction).toHaveBeenCalledTimes(1);
      expect(transactionService.createTransaction).not.toHaveBeenCalled();
    });
  });

  it('shows a demo success toast', async () => {
    const user = userEvent.setup();
    setupDemoMode(true);
    render(<AddTransactionPage />);

    await fillAndSubmitExpenseForm(user);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('sign up')
      );
    });
  });

  it('navigates to /transactions after demo submit', async () => {
    const user = userEvent.setup();
    setupDemoMode(true);
    render(<AddTransactionPage />);

    await fillAndSubmitExpenseForm(user);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/transactions');
    });
  });

  it('calls the real API when NOT in demo mode', async () => {
    const user = userEvent.setup();
    setupDemoMode(false);
    (transactionService.createTransaction as jest.Mock).mockResolvedValue({ success: true });
    render(<AddTransactionPage />);

    await fillAndSubmitExpenseForm(user);

    await waitFor(() => {
      expect(transactionService.createTransaction).toHaveBeenCalledTimes(1);
    });
  });

  it('records a demo transfer as two linked legs, with a simulated toast and no API call', async () => {
    const user = userEvent.setup();
    const { addDemoTransaction } = setupDemoMode(true);
    render(<AddTransactionPage />);

    await user.click(screen.getByText('Transfer'));
    const amountInput = screen.getAllByPlaceholderText('0')[0];
    await user.clear(amountInput);
    await user.type(amountInput, '500');
    const descriptionInput = screen.queryByPlaceholderText("What's this for?");
    if (descriptionInput) {
      await user.clear(descriptionInput);
      await user.type(descriptionInput, 'Wallet transfer');
    }
    await user.click(screen.getByRole('button', { name: /Add Transaction/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('common:demoAlert.changesSimulated');
    });
    // It used to report success and add nothing, so the transfer never showed
    // in the list. Both legs now land in demo state, sharing one group id.
    expect(addDemoTransaction).toHaveBeenCalledTimes(2);
    const legs = addDemoTransaction.mock.calls.map(([leg]) => leg);
    expect(legs.map((l) => l.type).sort()).toEqual(['expense', 'income']);
    expect(legs[0].transferGroupId).toBeTruthy();
    expect(legs[0].transferGroupId).toBe(legs[1].transferGroupId);
    expect(legs.every((l) => l.amount === 500)).toBe(true);
    const { transactionService } = jest.requireMock('@/services/transactionService');
    expect(transactionService.createTransfer).not.toHaveBeenCalled();
  });
});
