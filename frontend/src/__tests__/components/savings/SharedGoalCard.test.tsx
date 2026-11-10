import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SharedGoalCard from '@/components/savings/SharedGoalCard';
import type { SharedGoalOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars?.[k] ?? '')),
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

  it('shows each side once: you and the partner, with the share each put in', () => {
    render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
    expect(screen.getByText(/^You/)).toHaveTextContent('You · 60%');
    expect(screen.getByText(/^小明/)).toHaveTextContent('小明 · 40%');
    // Not your own name again under "You", nor the old "Alex: 60%" label row.
    expect(screen.queryByText(/Alex/)).toBeNull();
  });

  describe('pace', () => {
    afterEach(() => jest.useRealTimers());

    it('says what a month takes to reach the target on time', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:00:00Z'));
      render(<SharedGoalCard goal={BASE_GOAL} onViewRecords={onViewRecords} onDelete={onDelete} />);
      // NT$20,000 left over 91 days (2.99 months of 30.44 days): NT$6,690.1, rounded up.
      expect(screen.getByText(/a month between you reaches it on time/)).toHaveTextContent(/^NT\$6,691 a month/);
    });

    it('asks for no pace once the goal is reached or its date has passed', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:00:00Z'));
      const { rerender } = render(
        <SharedGoalCard goal={{ ...BASE_GOAL, status: 'completed', total_amount: 50000, progress_pct: 100 }} onViewRecords={onViewRecords} onDelete={onDelete} />,
      );
      expect(screen.queryByText(/a month between you/)).toBeNull();
      rerender(<SharedGoalCard goal={{ ...BASE_GOAL, target_date: '2026-08-01' }} onViewRecords={onViewRecords} onDelete={onDelete} />);
      expect(screen.queryByText(/a month between you/)).toBeNull();
    });
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
