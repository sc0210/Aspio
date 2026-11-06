import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateGoalModal from '@/components/savings/CreateGoalModal';
import { apiClient } from '@/lib/api-client';
import type { PeerConnectionOut, SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { createSharedGoal: jest.fn(), updateSharedGoal: jest.fn() },
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

  it('prefills the goal and saves through updateSharedGoal', async () => {
    (apiClient.updateSharedGoal as jest.Mock).mockResolvedValue({ data: goal });
    const onSuccess = jest.fn();
    render(<CreateGoalModal isOpen onClose={jest.fn()} onSuccess={onSuccess} connections={connections} goal={goal} />);

    expect(screen.getByText('Edit Savings Goal')).toBeInTheDocument();
    const title = screen.getByDisplayValue('Trip');
    fireEvent.change(title, { target: { value: 'Kyoto trip' } });
    fireEvent.change(screen.getByDisplayValue('1000'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.updateSharedGoal).toHaveBeenCalledWith('goal-1', {
      title: 'Kyoto trip', target_amount: 2500, target_date: null,
    }));
    expect(apiClient.createSharedGoal).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });
});
