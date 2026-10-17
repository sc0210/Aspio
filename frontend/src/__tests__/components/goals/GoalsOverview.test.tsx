import React from 'react';
import { render, screen } from '@testing-library/react';
import { GoalsOverview } from '@/components/goals/GoalsOverview';

// The card's own layout is under test, not its children: each goal card
// reports the title and the amount it was handed.
jest.mock('@/components/goals/AssetGoalCard', () => ({
    AssetGoalCard: ({ title, currentAmount }: { title: string; currentAmount: number }) => (
        <div data-testid="goal-card">{`${title}:${currentAmount}`}</div>
    ),
}));
jest.mock('@/hooks/usePortfolio', () => ({ usePortfolio: () => ({ portfolio: undefined }) }));
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true }) }));
// Keep the real module: the global i18n setup imports initReactI18next from it.
jest.mock('react-i18next', () => ({
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
        t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    }),
}));

// The card's own goal shape, taken from its props so the fixtures typecheck.
type OverviewGoal = NonNullable<React.ComponentProps<typeof GoalsOverview>['goals']>[number];

const goal = (over: Partial<OverviewGoal> & Pick<OverviewGoal, 'id' | 'title'>): OverviewGoal => ({
    currency: 'TWD',
    currentAmount: 0,
    targetAmount: 10_000_000,
    status: 'active',
    ...over,
});

describe('GoalsOverview', () => {
    it('lists a goal that only shares the retirement goal\'s title, on its own saved amount', () => {
        // The review case: an older, completed "Retirement Fund" beside the live
        // one. Splitting by title as well as id hid it from the card and its totals.
        render(
            <GoalsOverview
                portfolioTotalValue={7_000_000}
                goals={[
                    goal({ id: 'live', title: 'Retirement Fund' }),
                    goal({ id: 'old', title: 'Retirement Fund', status: 'completed', targetAmount: 5_000_000, currentAmount: 1_000 }),
                ]}
            />,
        );

        expect(screen.getAllByText('Retirement Fund')).toHaveLength(1); // the retirement card
        // The other one is a card of its own, credited nothing from the portfolio.
        expect(screen.getByTestId('goal-card')).toHaveTextContent('Retirement Fund:1000');
    });

    it('credits the portfolio to one retirement goal when two match', () => {
        render(
            <GoalsOverview
                portfolioTotalValue={7_000_000}
                goals={[
                    goal({ id: 'smaller', title: 'FIRE by 45', targetAmount: 3_000_000 }),
                    goal({ id: 'larger', title: 'Retirement Fund', targetAmount: 10_000_000 }),
                ]}
            />,
        );

        // The larger target is credited and shown as the retirement card; the
        // smaller keeps its own NT$0 instead of a second copy of the portfolio.
        expect(screen.getByText('Retirement Fund')).toBeInTheDocument();
        expect(screen.getByTestId('goal-card')).toHaveTextContent('FIRE by 45:0');
    });
});
