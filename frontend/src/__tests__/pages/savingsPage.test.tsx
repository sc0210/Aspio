/**
 * /savings after /compare folded into it.
 *
 * The two pages each fetched and listed the same peer connections. What has to
 * hold now: the roster renders once, the tab is read from and written to the URL
 * (the /compare redirect lands on ?tab=compare), and the comparison is only
 * fetched when its tab is actually shown.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavingsPage from '@/app/savings/page';
import { apiClient } from '@/lib/api-client';
import { demoPeerConnections, demoSavingRecords, demoSharedGoals } from '@/data/demoData';

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  usePathname: () => '/savings',
  useSearchParams: () => mockSearch,
}));

const demoAuth = {
  mode: 'demo' as const,
  isAuthenticated: false,
  isDemo: true,
  // Not the fixtures' demo-user-1, as in the app: DemoContext's user id and the
  // seeded records' owner id differ, and a test using one id for both hid a bug.
  user: { id: 'demo-session-user' },
  canPersistData: false,
  session: null,
  status: 'unauthenticated' as const,
};
let mockAuth: Record<string, unknown> = demoAuth;

jest.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mockAuth,
}));

jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => ({ ...mockAuth, isLoading: false }),
}));

// A viewer who prefers USD: the compare figures still arrive in TWD, so they
// must still be labelled TWD. The page no longer reads this at all.
jest.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ data: { preferred_currency: 'USD' } }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getPeerConnections: jest.fn(),
    listSharedGoals: jest.fn(),
    getPeerCompareData: jest.fn(),
    removePeerConnection: jest.fn(),
    deleteSharedGoal: jest.fn(),
  },
}));

// t() honours an inline default, as i18next does; keys without one echo.
jest.mock('react-i18next', () => {
  // One t for every render, as react-i18next gives. A fresh function per render
  // changes the identity of every useCallback that lists t, re-running the page's
  // load effect — which in demo mode resets goals to the fixtures under the test.
  const t = (k: string, d?: unknown) => (typeof d === 'string' ? d : k);
  return {
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t }),
  };
});

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The chart is the page's only next/dynamic import.
jest.mock('next/dynamic', () => () => function CompareChartStub() {
  return <div data-testid="compare-chart" />;
});
jest.mock('@/components/compare/CompareStatCards', () => function CompareStatsStub({ currency }: { currency: string }) {
  return <div data-testid="compare-stats">{currency}</div>;
});
jest.mock('@/components/savings/SharedGoalCard', () => function GoalCardStub({
  goal,
  onViewRecords,
}: {
  goal: { id: string; your_amount: number; peer_amount: number; total_amount: number };
  onViewRecords: (goal: unknown) => void;
}) {
  return (
    <div data-testid="goal-card">
      <span>{`${goal.id}:${goal.your_amount}+${goal.peer_amount}/${goal.total_amount}`}</span>
      <button type="button" onClick={() => onViewRecords(goal)}>{`records ${goal.id}`}</button>
    </div>
  );
});
jest.mock('@/components/compare/AddPeerModal', () => () => null);
jest.mock('@/components/compare/PendingInviteBanner', () => () => null);
jest.mock('@/components/savings/CreateGoalModal', () => () => null);
// Stands in for a deposit made in the records modal: it reports the change, as the real one does.
jest.mock('@/components/savings/SavingRecordsModal', () => function RecordsStub({
  goal,
  onRecordChanged,
}: {
  goal: { id: string } | null;
  onRecordChanged: (goalId: string) => void;
}) {
  return goal ? <button type="button" onClick={() => onRecordChanged(goal.id)}>record changed</button> : null;
});

const api = apiClient as unknown as Record<string, jest.Mock>;
const acceptedPeers = demoPeerConnections.filter((c) => c.status === 'accepted');

describe('/savings — goals and compare as tabs over one roster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = new URLSearchParams();
    mockAuth = demoAuth;
  });

  it('lists each peer once, not once per view', async () => {
    render(<SavingsPage />);

    for (const peer of acceptedPeers) {
      expect(await screen.findAllByText(peer.other_user.name)).toHaveLength(1);
    }
  });

  it('opens on shared goals by default', async () => {
    render(<SavingsPage />);

    expect(await screen.findByRole('tab', { name: 'savings.tabs.goals' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByTestId('goal-card').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('compare-chart')).not.toBeInTheDocument();
  });

  it('opens on the comparison when the URL asks for it — where /compare redirects', async () => {
    mockSearch = new URLSearchParams('tab=compare');
    render(<SavingsPage />);

    expect(await screen.findByRole('tab', { name: 'savings.tabs.compare' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('compare-chart')).toBeInTheDocument();
    // The figures are TWD whatever the viewer prefers; a USD label put "$" on NT$ amounts.
    expect(screen.getByTestId('compare-stats')).toHaveTextContent('TWD');
  });

  it('writes the tab to the URL, from a click and from the arrow keys', async () => {
    const user = userEvent.setup();
    render(<SavingsPage />);

    await user.click(await screen.findByRole('tab', { name: 'savings.tabs.compare' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/savings?tab=compare', { scroll: false });

    screen.getByRole('tab', { name: 'savings.tabs.goals' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(mockReplace).toHaveBeenLastCalledWith('/savings?tab=compare', { scroll: false });
  });

  it("moves a goal's totals when a deposit is recorded in demo mode", async () => {
    // Totals are the sum of saving records; with no backend to recompute them,
    // a demo deposit used to show in the records list and nowhere on the card.
    const user = userEvent.setup();
    const goal = demoSharedGoals[0];
    const seeded = demoSavingRecords[goal.id];
    render(<SavingsPage />);
    expect(
      await screen.findByText(`${goal.id}:${goal.your_amount}+${goal.peer_amount}/${goal.total_amount}`),
    ).toBeInTheDocument();

    demoSavingRecords[goal.id] = [
      ...seeded,
      {
        // Filed under the goal's owner, as the records modal does in demo.
        id: 'demo-new', goal_id: goal.id, user_id: goal.your_user_id, user_name: goal.your_name,
        amount: 1000, record_date: '2026-09-13', note: null, created_at: '2026-09-13T00:00:00Z',
      },
    ];
    try {
      await user.click(screen.getByRole('button', { name: `records ${goal.id}` }));
      await user.click(screen.getByRole('button', { name: 'record changed' }));

      // Your share rises by the deposit and the peer's does not move. Checking
      // only the total passed while every seeded deposit was moved to the peer.
      expect(
        await screen.findByText(
          `${goal.id}:${goal.your_amount + 1000}+${goal.peer_amount}/${goal.total_amount + 1000}`,
        ),
      ).toBeInTheDocument();
    } finally {
      demoSavingRecords[goal.id] = seeded;
    }
  });

  it('reads demo goal totals from the saving records, so a deposit survives a remount', async () => {
    // The records modal edits the record fixture in memory. Loading the static
    // goal amounts on mount put the card back to its seeded totals while the
    // records list still held the deposit.
    const goal = demoSharedGoals[0];
    const seeded = demoSavingRecords[goal.id];
    demoSavingRecords[goal.id] = [
      ...seeded,
      {
        id: 'demo-kept', goal_id: goal.id, user_id: goal.your_user_id, user_name: goal.your_name,
        amount: 1000, record_date: '2026-09-13', note: null, created_at: '2026-09-13T00:00:00Z',
      },
    ];
    try {
      render(<SavingsPage />);
      expect(
        await screen.findByText(
          `${goal.id}:${goal.your_amount + 1000}+${goal.peer_amount}/${goal.total_amount + 1000}`,
        ),
      ).toBeInTheDocument();
    } finally {
      demoSavingRecords[goal.id] = seeded;
    }
  });

  it('offers to invite again in demo mode once every sample peer is removed', async () => {
    const user = userEvent.setup();
    render(<SavingsPage />);

    for (const button of await screen.findAllByRole('button', { name: 'Remove {{name}}' })) {
      await user.click(button);
    }

    expect(await screen.findByText('Invite a peer to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('calls no API in demo mode, on either tab', async () => {
    mockSearch = new URLSearchParams('tab=compare');
    render(<SavingsPage />);

    await screen.findByTestId('compare-chart');
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  describe('signed in', () => {
    beforeEach(() => {
      mockAuth = { ...demoAuth, mode: 'authenticated', isAuthenticated: true, isDemo: false, canPersistData: true, status: 'authenticated' };
      api.getPeerConnections.mockResolvedValue({ data: acceptedPeers });
      api.listSharedGoals.mockResolvedValue({ data: [] });
      api.getPeerCompareData.mockResolvedValue({ data: { users: [], chart: [] } });
    });

    it('does not fetch the comparison for a visit to goals', async () => {
      render(<SavingsPage />);

      await screen.findByRole('tab', { name: 'savings.tabs.goals' });
      expect(api.getPeerCompareData).not.toHaveBeenCalled();
    });

    it('still offers to invite while every invite is pending, instead of an empty page', async () => {
      const sentOnly = [{ ...acceptedPeers[0], id: 'sent-1', direction: 'sent', status: 'pending' }];
      api.getPeerConnections.mockResolvedValue({ data: sentOnly });
      render(<SavingsPage />);

      expect(await screen.findByText('Invite a peer to get started.')).toBeInTheDocument();
      expect(screen.getByText('pending')).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('tries the comparison again when its tab is chosen after a failure', async () => {
      const user = userEvent.setup();
      api.getPeerCompareData.mockRejectedValueOnce(new Error('compare down'));
      mockSearch = new URLSearchParams('tab=compare');
      render(<SavingsPage />);

      expect(await screen.findByText('compare down')).toBeInTheDocument();
      await user.click(screen.getByRole('tab', { name: 'savings.tabs.compare' }));

      expect(await screen.findByTestId('compare-chart')).toBeInTheDocument();
      expect(api.getPeerCompareData).toHaveBeenCalledTimes(2);
    });

    it('shows an empty comparison, not an endless skeleton, when the response carries no data', async () => {
      api.getPeerCompareData.mockResolvedValue({ data: null });
      mockSearch = new URLSearchParams('tab=compare');
      render(<SavingsPage />);

      expect(await screen.findByTestId('compare-chart')).toBeInTheDocument();
    });

    it('keeps other query parameters when switching tabs', async () => {
      const user = userEvent.setup();
      mockSearch = new URLSearchParams('tab=compare&utm_source=line');
      render(<SavingsPage />);

      await user.click(await screen.findByRole('tab', { name: 'savings.tabs.goals' }));
      expect(mockReplace).toHaveBeenLastCalledWith('/savings?utm_source=line', { scroll: false });
    });

    it('refreshes goals after a record change without reloading the roster or blanking the page', async () => {
      const user = userEvent.setup();
      api.listSharedGoals.mockResolvedValue({ data: [demoSharedGoals[0]] });
      render(<SavingsPage />);

      await user.click(await screen.findByRole('button', { name: `records ${demoSharedGoals[0].id}` }));
      await user.click(screen.getByRole('button', { name: 'record changed' }));

      await waitFor(() => expect(api.listSharedGoals).toHaveBeenCalledTimes(2));
      expect(api.getPeerConnections).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('fetches the comparison once when its tab is shown', async () => {
      mockSearch = new URLSearchParams('tab=compare');
      render(<SavingsPage />);

      await screen.findByTestId('compare-chart');
      await waitFor(() => expect(api.getPeerCompareData).toHaveBeenCalledTimes(1));
    });
  });
});
