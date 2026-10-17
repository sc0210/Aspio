import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SharedGoalCard from '@/components/savings/SharedGoalCard';
import type { SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span data-testid="trash-icon" />,
  CheckCircleIcon: () => <span data-testid="check-icon" />,
  ListBulletIcon: () => <span data-testid="records-icon" />,
}));

const BASE_GOAL: SharedGoalOut = {
  id: 'goal-1',
  connection_id: 'conn-1',
  title: 'Japan Trip Fund',
  target_amount: 50000,
  target_date: '2026-12-01',
  status: 'active',
  your_amount: 18000,
  peer_amount: 12000,
  your_name: 'Alex',
  peer_name: '小明',
  your_user_id: 'user-1',
  peer_user_id: 'user-2',
  total_amount: 30000,
  progress_pct: 60,
  is_creator: true,
  created_at: '2026-01-01T00:00:00Z',
};

const noop = jest.fn();

describe('SharedGoalCard', () => {
  const onViewRecords = jest.fn();
  const onDelete = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('renders the goal title', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByText('Japan Trip Fund')).toBeInTheDocument();
  });

  it('renders progress percentage text', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('renders your_name and peer_name in contribution section', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('小明')).toBeInTheDocument();
  });

  it('shows completed badge when status is completed', () => {
    const goal = { ...BASE_GOAL, status: 'completed' as const };
    render(<SharedGoalCard goal={goal} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByText('Goal reached!')).toBeInTheDocument();
  });

  it('does not show completed badge when status is active', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.queryByText('Goal reached!')).toBeNull();
  });

  it('shows records button always', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByTestId('records-icon')).toBeInTheDocument();
  });

  it('shows records button even when completed', () => {
    const goal = { ...BASE_GOAL, status: 'completed' as const };
    render(<SharedGoalCard goal={goal} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByTestId('records-icon')).toBeInTheDocument();
  });

  it('hides delete button when is_creator is false', () => {
    const goal = { ...BASE_GOAL, is_creator: false };
    render(<SharedGoalCard goal={goal} onViewRecords={noop} onDelete={onDelete} />);
    expect(screen.queryByTestId('trash-icon')).toBeNull();
  });

  it('shows delete button when is_creator is true', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={noop} onDelete={onDelete} />);
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
  });

  it('disables delete button when deleting is true', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={noop} onDelete={onDelete} deleting={true} />);
    const trashBtn = screen.getByTestId('trash-icon').closest('button') as HTMLButtonElement;
    expect(trashBtn.disabled).toBe(true);
  });

  it('delete button is enabled when deleting is false', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={noop} onDelete={onDelete} deleting={false} />);
    const trashBtn = screen.getByTestId('trash-icon').closest('button') as HTMLButtonElement;
    expect(trashBtn.disabled).toBe(false);
  });

  it('calls onViewRecords with the goal when records button clicked', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={noop} />);
    fireEvent.click(screen.getByTestId('records-icon').closest('button')!);
    expect(onViewRecords).toHaveBeenCalledWith(BASE_GOAL);
  });

  it('calls onDelete with goal.id when delete button clicked', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={noop} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('trash-icon').closest('button')!);
    expect(onDelete).toHaveBeenCalledWith('goal-1');
  });
});
