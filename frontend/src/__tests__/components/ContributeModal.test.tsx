import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContributeModal } from '@/components/goals/ContributeModal';

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/hooks/useGoals', () => ({
  useAddContribution: () => ({
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/utils/formatters', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount}`,
  localDateString: () => '2026-05-23',
}));

jest.mock('@headlessui/react', () => {
  function Dialog({ children }: { children: React.ReactNode }) {
    return <div data-testid="dialog">{children}</div>;
  }
  function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
    return <h2 className={className}>{children}</h2>;
  }
  function DialogPanel({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div data-testid="dialog-panel" className={className}>{children}</div>;
  }
  Dialog.Title = DialogTitle;
  Dialog.Panel = DialogPanel;

  function Transition({ children, show }: { children: React.ReactNode; show: boolean }) {
    return show ? <>{children}</> : null;
  }
  function TransitionChild({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  Transition.Child = TransitionChild;

  // Headless UI v2 exports DialogPanel / DialogTitle / TransitionChild as named
  // top-level components, and ContributeModal imports them that way. Returning
  // only the v1 compound form (Dialog.Panel, Transition.Child) left those
  // imports undefined and React refused to render the modal at all. Both forms
  // are exported here so either import style resolves.
  return {
    Dialog,
    DialogTitle,
    DialogPanel,
    Transition,
    TransitionChild,
    Fragment: React.Fragment,
  };
});

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
  const presetName = (percentage: number) =>
    new RegExp(`Set contribution to ${percentage}% of remaining amount`, 'i');

  describe('Quick-amount preset buttons', () => {
    it('renders four quick-amount preset buttons (25%, 50%, 75%, 100%)', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        expect(screen.getByRole('button', { name: presetName(percentage) })).toBeInTheDocument();
      });
    });

    it('each quick-amount button shows its percentage as visible text', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        expect(
          screen.getByRole('button', { name: presetName(percentage) }).textContent,
        ).toContain(`${percentage}%`);
      });
    });

    it('each quick-amount button has min-h-[44px] class for 44px touch target', () => {
      render(<ContributeModal {...defaultProps} />);
      [25, 50, 75, 100].forEach((percentage) => {
        const btn = screen.getByRole('button', { name: presetName(percentage) });
        expect(btn.className).toContain('min-h-[44px]');
      });
    });
  });
});
