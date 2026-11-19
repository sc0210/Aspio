import React from 'react';
import { render, screen } from '@testing-library/react';
import { AssetGoalCard } from '@/components/goals/AssetGoalCard';

jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
// Echo the key plus the amount, so the test reads which line rendered.
jest.mock('react-i18next', () => ({
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
        t: (key: string, opts?: { amount?: string }) => (opts?.amount ? `${key}:${opts.amount}` : key),
    }),
}));

describe('AssetGoalCard progress', () => {
    it('caps an overfunded goal at 100% and states the surplus', () => {
        // The review case: an emergency fund 10× its target read "1000.0%".
        render(<AssetGoalCard title="Emergency" currentAmount={250_000} targetAmount={25_000} currency="TWD" />);
        expect(screen.getByText('100.0%')).toBeInTheDocument();
        expect(screen.queryByText('1000.0%')).toBeNull();
        expect(screen.getByText(/^goals:card\.over:/)).toBeInTheDocument();
        expect(screen.queryByText(/^goals:card\.left:/)).toBeNull();
    });

    it('shows the true percentage and what is left below target', () => {
        render(<AssetGoalCard title="House" currentAmount={45_000} targetAmount={100_000} currency="TWD" />);
        expect(screen.getByText('45.0%')).toBeInTheDocument();
        expect(screen.getByText(/^goals:card\.left:/)).toBeInTheDocument();
        expect(screen.queryByText(/^goals:card\.over:/)).toBeNull();
    });

    it('caps the dense card too', () => {
        render(<AssetGoalCard title="Emergency" currentAmount={250_000} targetAmount={25_000} currency="TWD" dense />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});

describe('AssetGoalCard surplus line', () => {
    it('is not shown for an invested goal over target by market value alone', () => {
        // Saved 80k of 100k, now worth 130k: not reached, so no "over target".
        render(<AssetGoalCard title="Fund" currentAmount={80_000} targetAmount={100_000} investedAmount={80_000}
            valueAmount={130_000} currency="TWD" />);
        expect(screen.queryByText(/^goals:card\.over:/)).toBeNull();
    });
});
