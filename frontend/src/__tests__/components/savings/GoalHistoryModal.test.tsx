import React from 'react';
import { render, screen } from '@testing-library/react';
import GoalHistoryModal from '@/components/savings/GoalHistoryModal';
import { apiClient } from '@/lib/api-client';
import type { SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars?.[k] ?? '')),
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/api-client', () => ({ apiClient: { getSharedGoalHistory: jest.fn() } }));
// Recharts is the only dynamic import here; its rows are what is under test.
jest.mock('next/dynamic', () => () => function ChartStub() {
  return <div data-testid="history-chart" />;
});

const goal = {
  id: 'goal-1', title: 'Wedding', target_amount: 30000, peer_name: 'Bob',
} as unknown as SharedGoalOut;
const api = apiClient as unknown as Record<string, jest.Mock>;

describe('GoalHistoryModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists each side by day, newest first, a release as money taken back', async () => {
    api.getSharedGoalHistory.mockResolvedValue({ data: [
      { date: '2026-03-01', side: 'you', amount: 300 },
      { date: '2026-03-01', side: 'partner', amount: 200 },
      { date: '2026-03-05', side: 'you', amount: -100 },
    ] });
    render(<GoalHistoryModal goal={goal} isDemo={false} onClose={jest.fn()} />);

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Mar 5, 2026You−NT$100',
      'Mar 1, 2026You+NT$300',
      'Mar 1, 2026Bob+NT$200',
    ]);
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();
    expect(api.getSharedGoalHistory).toHaveBeenCalledWith('goal-1');
  });

  it('says when nothing is set aside yet, and when the history fails to load', async () => {
    api.getSharedGoalHistory.mockResolvedValueOnce({ data: [] });
    const { unmount } = render(<GoalHistoryModal goal={goal} isDemo={false} onClose={jest.fn()} />);
    expect(await screen.findByText('Nothing set aside yet')).toBeInTheDocument();
    unmount();

    api.getSharedGoalHistory.mockRejectedValueOnce(new Error('down'));
    render(<GoalHistoryModal goal={goal} isDemo={false} onClose={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the history');
  });
});
