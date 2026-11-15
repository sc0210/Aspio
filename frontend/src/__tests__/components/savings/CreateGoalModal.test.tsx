import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateGoalModal from '@/components/savings/CreateGoalModal';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut, SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars?.[k] ?? '')),
  }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    createSharedGoal: jest.fn(), updateSharedGoal: jest.fn(), linkSharedGoal: jest.fn(),
    get: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

const connections: PeerConnectionOut[] = [
  { id: 'conn-1', other_user: { id: 'u2', name: 'Bob', username: 'bob', avatar_url: null },
    status: 'accepted', direction: 'sent', created_at: '2026-05-01T00:00:00Z' },
];

const goal = {
  id: 'goal-1', connection_id: 'conn-1', title: 'Trip', target_amount: 1000, target_date: null,
  status: 'active', your_amount: 0, peer_amount: 0,
} as unknown as SharedGoalOut;

describe('CreateGoalModal in edit mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefills the goal and saves its title and date (each part’s target is its own goal’s)', async () => {
    (apiClient.updateSharedGoal as jest.Mock).mockResolvedValue({ data: goal });
    const onSuccess = jest.fn();
    render(<CreateGoalModal isOpen onClose={jest.fn()} onSuccess={onSuccess} connections={connections} goal={goal} />);

    expect(screen.getByText('Edit Savings Goal')).toBeInTheDocument();
    expect(screen.queryByText('Your part')).toBeNull();
    const title = screen.getByDisplayValue('Trip');
    fireEvent.change(title, { target: { value: 'Kyoto trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.updateSharedGoal).toHaveBeenCalledWith('goal-1', {
      title: 'Kyoto trip', target_date: null,
    }));
    expect(apiClient.createSharedGoal).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });
});

describe('CreateGoalModal creating', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends your part as a new goal', async () => {
    (apiClient.createSharedGoal as jest.Mock).mockResolvedValue({ data: goal });
    render(<CreateGoalModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} connections={connections} />);

    fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Wedding' } });
    fireEvent.change(screen.getByLabelText('Your part (TWD)'), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Goal' }));

    await waitFor(() => expect(apiClient.createSharedGoal).toHaveBeenCalledWith({
      connection_id: 'conn-1', title: 'Wedding', target_date: null, my_target: 30000,
    }));
  });

  it('can use a goal you already have, but not one that is already a part', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: [
      { id: 'mine-1', title: 'Flat fund', targetAmount: 80000, status: 'active', sharedGoalId: null },
      { id: 'mine-2', title: 'Taken', targetAmount: 100, status: 'active', sharedGoalId: 'other' },
      { id: 'mine-3', title: 'Dropped', targetAmount: 100, status: 'cancelled', sharedGoalId: null },
    ] });
    (apiClient.createSharedGoal as jest.Mock).mockResolvedValue({ data: goal });
    render(<CreateGoalModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} connections={connections} />);

    fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Our flat' } });
    fireEvent.click(await screen.findByLabelText('A goal I already have'));
    const picker = screen.getByLabelText('Your goal');
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Choose a goal…', 'Flat fund · NT$80,000',
    ]);
    fireEvent.change(picker, { target: { value: 'mine-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Goal' }));

    await waitFor(() => expect(apiClient.createSharedGoal).toHaveBeenCalledWith({
      connection_id: 'conn-1', title: 'Our flat', target_date: null, goal_id: 'mine-1',
    }));
  });
});

describe('CreateGoalModal joining', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers your partner’s part as yours and hands back your goal', async () => {
    const part = { id: 'part-1', title: 'Trip' };
    (apiClient.linkSharedGoal as jest.Mock).mockResolvedValue({ data: part });
    const onJoined = jest.fn();
    const joinGoal = { ...goal, peer_target: 600, peer_joined: true, peer_name: 'Bob' } as SharedGoalOut;
    render(<CreateGoalModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} connections={connections}
      joinGoal={joinGoal} onJoined={onJoined} />);

    expect(screen.getByText('Your part of Trip')).toBeInTheDocument();
    expect(screen.getByLabelText('Your part (TWD)')).toHaveValue(600);
    fireEvent.click(screen.getByRole('button', { name: 'Add my part' }));

    await waitFor(() => expect(apiClient.linkSharedGoal).toHaveBeenCalledWith('goal-1', { target_amount: 600 }));
    expect(onJoined).toHaveBeenCalledWith(part);
  });
});

describe('CreateGoalModal errors', () => {
  it('drops a failed attempt’s error when reopened', async () => {
    (apiClient.updateSharedGoal as jest.Mock).mockRejectedValue(new Error('server said no'));
    const props = { onClose: jest.fn(), onSuccess: jest.fn(), connections, goal };
    const { rerender } = render(<CreateGoalModal isOpen {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('server said no')).toBeInTheDocument();

    rerender(<CreateGoalModal isOpen={false} {...props} />);
    rerender(<CreateGoalModal isOpen {...props} />);
    expect(screen.queryByText('server said no')).not.toBeInTheDocument();
  });

  it('keeps an edit in progress when handed an equal goal object', () => {
    const props = { onClose: jest.fn(), onSuccess: jest.fn(), connections };
    const { rerender } = render(<CreateGoalModal isOpen {...props} goal={goal} />);
    fireEvent.change(screen.getByDisplayValue('Trip'), { target: { value: 'Typing…' } });

    rerender(<CreateGoalModal isOpen {...props} goal={{ ...goal }} />);
    expect(screen.getByDisplayValue('Typing…')).toBeInTheDocument();
  });
});
