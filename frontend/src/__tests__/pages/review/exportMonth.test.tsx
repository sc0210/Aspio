/** /review exports the month on screen as a CSV; not in demo mode. */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewPage from '@/app/review/page';
import { monthRange } from '@/lib/review';

const mockMode = { isAuthenticated: true, isDemo: false, isLoading: false };
const mockEmpty = { value: false };
const mockDownload = jest.fn().mockResolvedValue(undefined);
const range = monthRange('2026-09', new Date(2026, 9, 20));

jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => mockMode }));
jest.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => false }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/services/transactionService', () => ({ transactionService: { downloadCSV: (...a: unknown[]) => mockDownload(...a) } }));
jest.mock('@/hooks/useMonthReview', () => ({
  useMonthReview: () => ({
    review: { range, isEmpty: mockEmpty.value }, context: {}, isLoading: false, isError: false,
  }),
}));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children, topBarActions }: { children: React.ReactNode; topBarActions?: React.ReactNode }) => (
    <div><div data-testid="topbar">{topBarActions}</div>{children}</div>
  ),
}));
jest.mock('@/components/review/MonthPicker', () => ({ MonthPicker: () => null }));
jest.mock('@/components/review/ReviewHero', () => ({ ReviewHero: () => null }));
jest.mock('@/components/review/MonthContextCard', () => ({ MonthContextCard: () => null }));
jest.mock('@/components/review/NextMonthCard', () => ({ NextMonthCard: () => null }));
jest.mock('@/components/review/SpendingBreakdown', () => ({ SpendingBreakdown: () => null, IncomeBreakdown: () => null }));
jest.mock('@/components/review/WealthMoveCard', () => ({ WealthMoveCard: () => null }));
jest.mock('@/components/review/TopExpensesCard', () => ({ TopExpensesCard: () => null }));
jest.mock('@/components/review/GoalsTodayCard', () => ({ GoalsTodayCard: () => null }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_k: string, f?: string) => (typeof f === 'string' ? f : _k) }),
}));

beforeEach(() => { mockMode.isDemo = false; mockMode.isAuthenticated = true; mockEmpty.value = false; mockDownload.mockClear(); });

it('exports exactly the month on screen', async () => {
  render(<ReviewPage />);
  fireEvent.click(screen.getByRole('button', { name: /Export month/ }));
  await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(range.from, range.to));
  expect(range.from).toBe('2026-09-01');
  expect(range.to).toBe('2026-09-30');
});

it('has no export in demo mode', () => {
  mockMode.isDemo = true;
  mockMode.isAuthenticated = false;
  render(<ReviewPage />);
  expect(screen.queryByRole('button', { name: /Export month/ })).not.toBeInTheDocument();
});


it('is disabled for a month with nothing recorded', () => {
  mockEmpty.value = true;
  render(<ReviewPage />);
  expect(screen.getByRole('button', { name: /Export month/ })).toBeDisabled();
});
