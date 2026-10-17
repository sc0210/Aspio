/**
 * The row stops re-rendering when nothing about it changed.
 *
 * This is the whole point of splitting `TransactionRow` out: it used to be
 * inline JSX inside the map, so there was no component boundary and nothing
 * React could skip — one keystroke in the search box, one checkbox, one day
 * group expanding re-rendered every row of every group, each with its own
 * icons, badges and Headless UI menu. There is no React Compiler in this
 * project to do it automatically, so the memo is load-bearing rather than
 * decorative, and it is only as good as the props: one unstable callback or a
 * `selectedTransactions` array passed down would quietly undo all of it.
 *
 * Renders are counted through `getCategoryIcon`, which every row calls exactly
 * once. Counting a real call the component already makes avoids instrumenting
 * the component for its own test.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Transaction } from '@/shared/types';

const mockGetCategoryIcon = jest.fn((category: string) => `icon:${category}`);
jest.mock('@/utils/categoryIcon', () => ({
    getCategoryIcon: (category: string) => mockGetCategoryIcon(category),
}));

jest.mock('react-hot-toast', () => {
    const t = Object.assign(jest.fn(() => 'toast-id'), {
        success: jest.fn(), error: jest.fn(), dismiss: jest.fn(), custom: jest.fn(),
    });
    return { __esModule: true, default: t, toast: t };
});

jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            typeof opts?.defaultValue === 'string' ? (opts.defaultValue as string) : key,
    }),
}));

jest.mock('@/hooks/api-hooks', () => ({
    useDeleteTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useUpdateTransaction: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useSetDayOrder: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { TransactionList } from '@/components/transactions/TransactionList';

const tx = (id: string, category: string): Transaction => ({
    id,
    userId: 'u1',
    type: 'expense',
    amount: 100,
    currency: 'TWD',
    category,
    description: `Transaction ${id}`,
    // One day, so all rows sit in a single group and one expand shows them all.
    date: new Date('2024-01-15T12:00:00Z'),
    paymentMethod: 'cash',
    tags: [],
    createdAt: new Date('2024-01-15T12:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z'),
});

const TRANSACTIONS = [tx('1', 'Alpha'), tx('2', 'Beta'), tx('3', 'Gamma')];

/** Renders for one row, by the category only that row carries. */
const rendersOf = (category: string) =>
    mockGetCategoryIcon.mock.calls.filter(([c]) => c === category).length;

function renderExpanded() {
    const view = render(<TransactionList transactions={TRANSACTIONS} />);
    // Day groups start collapsed; open the one group so the rows mount.
    const header = screen.getAllByRole('button', { name: /Expand|Collapse/ })[0];
    fireEvent.click(header);
    return view;
}

describe('TransactionRow re-rendering', () => {
    beforeEach(() => mockGetCategoryIcon.mockClear());

    it('mounts each row once', () => {
        renderExpanded();
        expect(rendersOf('Alpha')).toBe(1);
        expect(rendersOf('Beta')).toBe(1);
        expect(rendersOf('Gamma')).toBe(1);
    });

    it('selecting one row leaves the others alone', () => {
        renderExpanded();
        mockGetCategoryIcon.mockClear();

        fireEvent.click(screen.getByLabelText('Select transaction Transaction 1'));

        // The selected row re-renders because its own `isSelected` flipped.
        expect(rendersOf('Alpha')).toBe(1);
        // The others were handed identical props and must be skipped. Before the
        // split this was 1 apiece, and grows with the length of the list.
        expect(rendersOf('Beta')).toBe(0);
        expect(rendersOf('Gamma')).toBe(0);
    });

    it('deselecting is the same in reverse', () => {
        renderExpanded();
        const checkbox = screen.getByLabelText('Select transaction Transaction 2');

        fireEvent.click(checkbox);
        mockGetCategoryIcon.mockClear();
        fireEvent.click(checkbox);

        expect(rendersOf('Beta')).toBe(1);
        expect(rendersOf('Alpha')).toBe(0);
        expect(rendersOf('Gamma')).toBe(0);
    });
});
