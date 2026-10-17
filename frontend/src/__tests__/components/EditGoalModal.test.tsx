import React from 'react';
import { render } from '@testing-library/react';
import { EditGoalModal } from '@/components/goals/EditGoalModal';
import type { Goal } from '@/hooks/useGoals';

// ── Module mocks ─────────────────────────────────────────────────────────────
jest.mock('@/hooks/useGoals', () => ({
    useUpdateGoal: () => ({ mutateAsync: jest.fn().mockResolvedValue({}), isPending: false }),
}));

jest.mock('@headlessui/react', () => {
    const R = jest.requireActual('react');
    const Pass = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
    const Show = ({ children, show }: { children?: React.ReactNode; show?: boolean }) =>
        show === false ? null : R.createElement(R.Fragment, null, children);
    return {
        Dialog: ({ children }: { children?: React.ReactNode }) => R.createElement('div', { 'data-testid': 'dialog' }, children),
        DialogPanel: ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children),
        DialogTitle: ({ children }: { children?: React.ReactNode }) => R.createElement('h2', null, children),
        Transition: Show,
        TransitionChild: Pass,
        Fragment: R.Fragment,
    };
});

function makeGoal(targetDate: string | Date | undefined): Goal {
    return {
        id: 'g1', userId: 'u1', title: 'Emergency Fund', description: '', category: 'emergency_fund',
        priority: 'high', status: 'active', targetAmount: 25000, currentAmount: 15000,
        progressPercentage: 60, remainingAmount: 10000, currency: 'TWD', targetDate,
        startedAt: '2024-01-01', createdAt: '2024-01-01', updatedAt: '2024-01-01',
    } as Goal;
}

describe('EditGoalModal — targetDate normalization', () => {
    const noop = () => {};

    it('opens without crashing when targetDate is a Date object (regression)', () => {
        // Previously threw "goal.targetDate.split is not a function" and the modal
        // crashed via the goals error boundary — the Edit button appeared broken.
        const { container } = render(
            <EditGoalModal isOpen onClose={noop} goal={makeGoal(new Date('2024-12-31T00:00:00Z'))} />,
        );
        const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
        expect(dateInput).not.toBeNull();
        expect(dateInput.value).toBe('2024-12-31');
    });

    it('handles an ISO string targetDate', () => {
        const { container } = render(
            <EditGoalModal isOpen onClose={noop} goal={makeGoal('2025-06-15T12:00:00Z')} />,
        );
        const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
        expect(dateInput.value).toBe('2025-06-15');
    });

    it('handles a missing targetDate (empty field, no crash)', () => {
        const { container } = render(
            <EditGoalModal isOpen onClose={noop} goal={makeGoal(undefined)} />,
        );
        const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
        expect(dateInput.value).toBe('');
    });
});
