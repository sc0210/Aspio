import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContributeModal } from '@/components/goals/ContributeModal';

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/hooks/useGoals', () => ({
  useAddContribution: () => ({
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useReleaseFromGoal: () => ({
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useLifeCash: () => ({ data: { lifeBalance: 10000, reserved: 2000, available: 8000 } }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount}`,
  localDateString: () => '2026-05-23',
}));



// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  goalId: 'goal-1',
  goalTitle: 'Emergency Fund',
  currentAmount: 5000,
  targetAmount: 10000,
  currency: 'USD',
};

describe('ContributeModal — mobile UX fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Amount input', () => {
    it('renders the contribution amount input', () => {
      render(<ContributeModal {...defaultProps} />);
      const input = screen.getByRole('spinbutton'); // type="number"
      expect(input).toBeInTheDocument();
    });

    it('amount input has inputMode="decimal"', () => {
      render(<ContributeModal {...defaultProps} />);
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('inputMode', 'decimal');
    });
  });

  // Each preset carries aria-label="Set contribution to N% of remaining amount",
  // which REPLACES the visible "N%" as the button's accessible name. Querying
  // by the visible text finds nothing; match what a screen reader announces.
  // Found by the percentage they show: their accessible name is translated
  // ("Set contribution to 25% of remaining amount"), and this suite has no
  // translations loaded.
  const preset = (percentage: number) =>
    screen.getByText(`${percentage}%`, { selector: 'button' });

  describe('Quick-amount preset buttons', () => {
    it('renders four quick-amount preset buttons (25%, 50%, 75%, 100%)', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        expect(preset(percentage)).toBeInTheDocument();
      });
    });

    it('each quick-amount button shows its percentage as visible text', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        expect(
          preset(percentage).textContent,
        ).toContain(`${percentage}%`);
      });
    });

    it('each quick-amount button has min-h-[44px] class for 44px touch target', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        const btn = preset(percentage);
        expect(btn.className).toContain('min-h-[44px]');
      });
    });
  });
});
