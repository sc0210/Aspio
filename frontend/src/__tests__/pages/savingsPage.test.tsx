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
import { demoPeerConnections, demoSharedGoals } from '@/data/demoData';

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
  // fixtures' owner id differ.
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
    // The pace line reads every active goal's history.
    getSharedGoalHistory: jest.fn(() => Promise.resolve({ data: [] })),
    linkSharedGoal: jest.fn(),
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
  onViewHistory,
  onDelete,
  onEdit,
  onSetAside,
}: {
  goal: { id: string; your_amount: number; peer_amount: number; total_amount: number };
  onViewHistory: (goal: unknown) => void;
  onDelete: (id: string) => void;
  onEdit?: (goal: unknown) => void;
  onSetAside?: (goal: unknown) => void;
}) {
  return (
    <div data-testid="goal-card">
      <span>{`${goal.id}:${goal.your_amount}+${goal.peer_amount}/${goal.total_amount}`}</span>
      <button type="button" onClick={() => onViewHistory(goal)}>{`history ${goal.id}`}</button>
      {onSetAside && <button type="button" onClick={() => onSetAside(goal)}>{`set aside ${goal.id}`}</button>}
      <button type="button" onClick={() => onDelete(goal.id)}>{`delete ${goal.id}`}</button>
      {onEdit && <button type="button" onClick={() => onEdit(goal)}>{`edit ${goal.id}`}</button>}
    </div>
  );
});
jest.mock('@/components/compare/AddPeerModal', () => () => null);
jest.mock('@/components/compare/PendingInviteBanner', () => () => null);
// Only the "your part" form shows, so a test can see it open.
jest.mock('@/components/savings/CreateGoalModal', () => function GoalFormStub({ joinGoal }: { joinGoal?: { id: string } | null }) {
  return joinGoal ? <div>{`your part of ${joinGoal.id}`}</div> : null;
});
jest.mock('@/components/savings/GoalHistoryModal', () => function HistoryStub({ goal }: { goal: { id: string } | null }) {
  return goal ? <div>{`history of ${goal.id}`}</div> : null;
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
    expect(mockReplace).toHaveBeenLastCalledWith('/savings?tab=splits', { scroll: false });
  });

  it('opens Shared spending from ?tab=splits; demo mode shows sample bills, read-only', async () => {
    mockSearch = new URLSearchParams('tab=splits');
    const { QueryClient, QueryClientProvider } = jest.requireActual('@tanstack/react-query');
    render(<QueryClientProvider client={new QueryClient()}><SavingsPage /></QueryClientProvider>);
    expect(await screen.findByRole('tab', { name: 'savings.tabs.splits', selected: true })).toBeInTheDocument();
    expect(await screen.findByText(/Sample shared bills/)).toBeInTheDocument();
    expect(screen.getByText('Dinner at Din Tai Fung')).toBeInTheDocument();
    // Nothing can be saved, so nothing is offered.
    for (const name of ['Split a bill', 'Settle up', 'Accept', 'Withdraw', 'Cancel split']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    // No split setting either; the bill list's filters save nothing, so they stay.
    expect(screen.queryByRole('combobox', { name: /Bills from/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Insights' })).toBeInTheDocument();
  });

  it("opens a goal's history, in demo mode too", async () => {
    const user = userEvent.setup();
    const goal = demoSharedGoals[0];
    render(<SavingsPage />);

    await user.click(await screen.findByRole('button', { name: `history ${goal.id}` }));
    expect(screen.getByText(`history of ${goal.id}`)).toBeInTheDocument();
    expect(api.getSharedGoalHistory).not.toHaveBeenCalled();
  });

  it('offers to invite again in demo mode once every sample peer is removed', async () => {
    const user = userEvent.setup();
    render(<SavingsPage />);

    for (const button of await screen.findAllByRole('button', { name: 'Remove {{name}}' })) {
      await user.click(button);
      // Removing asks first: it ends the sharing for the partner too.
      await user.click(await screen.findByRole('button', { name: 'Remove' }));
    }

    expect(await screen.findByText('Invite a peer to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('asks before removing a peer, and Cancel keeps them', async () => {
    const user = userEvent.setup();
    render(<SavingsPage />);

    const [first] = await screen.findAllByRole('button', { name: 'Remove {{name}}' });
    const before = (await screen.findAllByRole('button', { name: 'Remove {{name}}' })).length;
    await user.click(first);
    expect(await screen.findByText('Remove this peer?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getAllByRole('button', { name: 'Remove {{name}}' })).toHaveLength(before);
  });

  it('offers no goal editing in demo mode', async () => {
    render(<SavingsPage />);
    await screen.findAllByRole('button', { name: /^delete / });
    expect(screen.queryByRole('button', { name: /^edit / })).not.toBeInTheDocument();
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

    it('asks for your part before setting money aside on a goal you have no part in', async () => {
      const user = userEvent.setup();
      const theirs = { ...demoSharedGoals[0], your_goal_id: null };
      const mine = { ...demoSharedGoals[1], your_goal_id: 'my-part' };
      api.listSharedGoals.mockResolvedValue({ data: [theirs, mine] });
      api.linkSharedGoal.mockResolvedValue({ data: { id: 'my-part', title: mine.title, currentAmount: 0, targetAmount: 1 } });
      render(<SavingsPage />);

      await user.click(await screen.findByRole('button', { name: `set aside ${theirs.id}` }));
      expect(screen.getByText(`your part of ${theirs.id}`)).toBeInTheDocument();
      expect(api.linkSharedGoal).not.toHaveBeenCalled();

      // With a part, it opens that goal straight away.
      await user.click(screen.getByRole('button', { name: `set aside ${mine.id}` }));
      await waitFor(() => expect(api.linkSharedGoal).toHaveBeenCalledWith(mine.id));
    });

    it('asks before deleting a goal; Cancel deletes nothing, confirming deletes once', async () => {
      const user = userEvent.setup();
      api.listSharedGoals.mockResolvedValue({ data: [demoSharedGoals[0]] });
      api.deleteSharedGoal.mockResolvedValue({ data: null });
      render(<SavingsPage />);
      const del = await screen.findByRole('button', { name: `delete ${demoSharedGoals[0].id}` });

      await user.click(del);
      expect(await screen.findByText('Delete this goal?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(api.deleteSharedGoal).not.toHaveBeenCalled();

      await user.click(del);
      await user.click(await screen.findByRole('button', { name: 'Delete goal' }));
      await waitFor(() => expect(api.deleteSharedGoal).toHaveBeenCalledTimes(1));
    });

    it('offers editing to a signed-in user', async () => {
      api.listSharedGoals.mockResolvedValue({ data: [demoSharedGoals[0]] });
      render(<SavingsPage />);
      expect(await screen.findByRole('button', { name: `edit ${demoSharedGoals[0].id}` })).toBeInTheDocument();
    });

    it('projects the pace from the active goals\' recent history', async () => {
      const goalOnTime = { ...demoSharedGoals[0], status: 'active' as const, target_date: '2099-01-01', target_amount: 50000, total_amount: 20000 };
      api.listSharedGoals.mockResolvedValue({ data: [goalOnTime] });
      const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      // Every fetch (the page loads goals more than once), then back to empty for the next tests.
      api.getSharedGoalHistory.mockImplementation(() => Promise.resolve({ data: [
        { date: recent, side: 'you', amount: 9000 },
      ] }));
      try {
        render(<SavingsPage />);
        await waitFor(() => expect(screen.getByTestId('savings-pace')).toHaveTextContent(/every active goal is reached by .*on time/));
        // And never the "nothing saved" line on the way there.
        expect(screen.queryByText(/Nothing saved toward the active goals/)).toBeNull();
        expect(api.getSharedGoalHistory).toHaveBeenCalledWith(goalOnTime.id);
      } finally {
        api.getSharedGoalHistory.mockImplementation(() => Promise.resolve({ data: [] }));
      }
    });

    it('fetches the comparison once when its tab is shown', async () => {
      mockSearch = new URLSearchParams('tab=compare');
      render(<SavingsPage />);

      await screen.findByTestId('compare-chart');
      await waitFor(() => expect(api.getPeerCompareData).toHaveBeenCalledTimes(1));
    });
  });
});
