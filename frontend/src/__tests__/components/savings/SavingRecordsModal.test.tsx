/**
 * Which saving records the modal lets you edit and delete.
 *
 * The page splits a goal's totals by one rule — a record is yours when it is
 * the session's or the goal's your_user_id — and the modal must mark rows by the
 * same one, or it highlights one set of deposits while the card totals another.
 * In demo the two ids genuinely differ (DemoContext's 'demo-user' against the
 * fixtures' 'demo-user-1'), which is how the split went wrong once already.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SavingRecordsModal from '@/components/savings/SavingRecordsModal';
import { apiClient } from '@/lib/api-client';
import { demoSavingRecords, demoSharedGoals } from '@/data/demoData';
import type { SavingRecord, SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => {
  const t = (k: string, d?: unknown) => (typeof d === 'string' ? d : k);
  return {
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t }),
  };
});

jest.mock('@/hooks/useDialog', () => ({
  useDialog: () => ({ panelRef: { current: null }, dialogProps: { role: 'dialog' } }),
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listSavingRecords: jest.fn(),
    addSavingRecord: jest.fn(),
    updateSavingRecord: jest.fn(),
    deleteSavingRecord: jest.fn(),
  },
}));

const record = (id: string, userId: string, amount: number): SavingRecord => ({
  id,
  goal_id: 'goal-x',
  user_id: userId,
  user_name: userId,
  amount,
  record_date: `2026-09-0${id.slice(-1)}`,
  note: null,
  created_at: '2026-09-01T00:00:00Z',
});

const editButtons = () => screen.queryAllByRole('button', { name: 'Edit record' });

describe('SavingRecordsModal — which rows are yours', () => {
  beforeEach(() => jest.clearAllMocks());

  it('in demo, marks the goal owner’s rows as yours even though the session id differs', async () => {
    // An owner id that is neither the session's nor the usual fixture id, so a
    // rule hard-coding either one fails here.
    const goal: SharedGoalOut = { ...demoSharedGoals[0], id: 'goal-x', your_user_id: 'fixture-owner' };
    const saved = demoSavingRecords['goal-x'];
    demoSavingRecords['goal-x'] = [
      record('r1', 'fixture-owner', 100),
      record('r2', 'fixture-owner', 200),
      record('r3', 'the-peer', 300),
    ];
    try {
      render(
        <SavingRecordsModal goal={goal} isDemo currentUserId="demo-user" onClose={jest.fn()} onRecordChanged={jest.fn()} />,
      );

      await waitFor(() => expect(screen.getAllByText('the-peer').length).toBeGreaterThan(0));
      expect(editButtons()).toHaveLength(2);
      expect(apiClient.listSavingRecords).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete demoSavingRecords['goal-x'];
      else demoSavingRecords['goal-x'] = saved;
    }
  });

  it('signed in, marks only the caller’s rows as yours', async () => {
    const goal: SharedGoalOut = { ...demoSharedGoals[0], id: 'goal-x', your_user_id: 'user-1', peer_user_id: 'user-2' };
    (apiClient.listSavingRecords as jest.Mock).mockResolvedValue({
      data: [record('r1', 'user-1', 100), record('r2', 'user-2', 200)],
    });

    render(
      <SavingRecordsModal goal={goal} isDemo={false} currentUserId="user-1" onClose={jest.fn()} onRecordChanged={jest.fn()} />,
    );

    await waitFor(() => expect(screen.getAllByText('user-2').length).toBeGreaterThan(0));
    expect(editButtons()).toHaveLength(1);
  });
});
