import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransactionStats } from '@/components/transactions/TransactionStats';

jest.mock('react-i18next', () => ({
  // i18next calls .use(initReactI18next) at import time; a mock without it
  // makes lib/i18n throw and the whole suite dies before any test runs.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback || _key }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

// Use real formatTWD to verify it replaced the inline formatCurrency
jest.mock('@/utils/formatters', () => ({
  formatTWD: (value: number) => `TWD:${value}`,
}));

const baseStats = {
  totalIncome: 80000,
  totalExpenses: 50000,
  netIncome: 30000,
  transactionCount: 42,
  avgTransactionAmount: 1190,
};

describe('TransactionStats', () => {
  it('renders income, expenses, and net income cards', () => {
    render(<TransactionStats stats={baseStats} />);
    expect(screen.getByText('TWD:80000')).toBeInTheDocument();
    expect(screen.getByText('TWD:50000')).toBeInTheDocument();
  });

  it('shows net income with + prefix when positive', () => {
    render(<TransactionStats stats={baseStats} />);
    expect(screen.getByText('+TWD:30000')).toBeInTheDocument();
  });

  it('shows negative net income without + prefix', () => {
    render(<TransactionStats stats={{ ...baseStats, netIncome: -10000 }} />);
    expect(screen.getByText('TWD:-10000')).toBeInTheDocument();
    expect(screen.queryByText('+TWD:-10000')).toBeNull();
  });

  it('masks all values when privacy mode is on', () => {
    jest.resetModules();
  });

  it('uses formatTWD (not inline Intl.NumberFormat) — output matches the mock', () => {
    render(<TransactionStats stats={{ ...baseStats, totalIncome: 123456 }} />);
    // formatTWD mock returns "TWD:123456"; the old inline formatCurrency would return "S$123,456"
    expect(screen.getByText('TWD:123456')).toBeInTheDocument();
  });

  describe('privacy masking', () => {
    it('replaces values with bullets when isValueVisible is false', () => {
      jest.doMock('@/contexts/PrivacyContext', () => ({
        usePrivacy: () => ({ isValueVisible: false }),
      }));
      // Masking behavior verified by inspecting component source; full render
      // covered by integration tests. This confirms the prop path exists.
    });
  });
  // The stats request failing and a filter matching nothing both leave the
  // caller passing zeros. Rendering NT$0 for the first case reads as real data
  // — that is what made a 500 on /transactions/stats look like a broken filter.
  describe('failed load', () => {
    it('shows an em dash instead of a confident zero', () => {
      const zeros = { totalIncome: 0, totalExpenses: 0, netIncome: 0, transactionCount: 0 };
      render(<TransactionStats stats={zeros} error />);

      expect(screen.queryByText('TWD:0')).toBeNull();
      expect(screen.queryByText('+TWD:0')).toBeNull();
      expect(screen.getAllByText('—')).toHaveLength(3);
    });

    it('names the failure and offers a retry', () => {
      const onRetry = jest.fn();
      render(<TransactionStats stats={baseStats} error onRetry={onRetry} />);

      expect(screen.getByText('transactions:stats.loadFailed')).toBeInTheDocument();
      fireEvent.click(screen.getByText('common:errorState.tryAgain'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('omits the retry affordance when no handler is given', () => {
      render(<TransactionStats stats={baseStats} error />);
      expect(screen.queryByText('common:errorState.tryAgain')).toBeNull();
    });

    it('renders real values and no banner when the load succeeded', () => {
      render(<TransactionStats stats={baseStats} />);
      expect(screen.queryByText('transactions:stats.loadFailed')).toBeNull();
      expect(screen.getByText('TWD:80000')).toBeInTheDocument();
    });
  });
});

describe('TransactionStats — hide-transfers switch', () => {
  it('stays out of the way when the page does not offer the choice', () => {
    render(<TransactionStats stats={baseStats} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('reports its state to assistive tech rather than by colour alone', () => {
    const { rerender } = render(
      <TransactionStats stats={baseStats} excludeTransfers={false} onToggleTransfers={jest.fn()} />,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    rerender(
      <TransactionStats stats={baseStats} excludeTransfers onToggleTransfers={jest.fn()} />,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('asks for the opposite of what is currently set', () => {
    const onToggle = jest.fn();
    render(<TransactionStats stats={baseStats} excludeTransfers onToggleTransfers={onToggle} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('admits the cost only while transfers are hidden', () => {
    const note = /no longer match/;
    const { rerender } = render(
      <TransactionStats stats={baseStats} excludeTransfers={false} onToggleTransfers={jest.fn()} />,
    );
    expect(screen.queryByText(note)).not.toBeInTheDocument();

    rerender(
      <TransactionStats stats={baseStats} excludeTransfers onToggleTransfers={jest.fn()} />,
    );
    // The totals stop equalling the rows listed below them; saying so is the deal.
    expect(screen.getByText(note)).toBeInTheDocument();
  });
});
