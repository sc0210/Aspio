/**
 * A split share can't be deleted, re-split or re-ratioed from its row, so the
 * row has to say where that happens: the Shared Spending tab.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Transaction } from '@/shared/types';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import en from '@/locales/en/transactions.json';
import zhTW from '@/locales/zh-TW/transactions.json';

jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({
        t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
    }),
}));

const tx = (extra: Partial<Transaction> = {}): Transaction => ({
    id: 't1',
    userId: 'u1',
    type: 'expense',
    amount: 300,
    currency: 'TWD',
    category: 'Dining',
    description: 'Dinner',
    date: new Date('2026-11-01T12:00:00Z'),
    paymentMethod: 'cash',
    tags: [],
    createdAt: new Date('2026-11-01T12:00:00Z'),
    updatedAt: new Date('2026-11-01T12:00:00Z'),
    ...extra,
});

function renderRow(transaction: Transaction) {
    render(
        <TransactionRow
            transaction={transaction}
            index={0}
            isSelected={false}
            isValueVisible
            isDeleting={false}
            onSelect={jest.fn()}
            onDelete={jest.fn()}
            onSplit={jest.fn()}
        />,
    );
}

/** Headless UI marks the rest of the page inert while the menu is open. */
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Actions for Dinner/ }));

describe('TransactionRow split share', () => {
    it('links the badge and the menu to the Shared Spending tab', () => {
        renderRow(tx({ peerSplitShareId: 's1' } as Partial<Transaction>));

        expect(screen.getByRole('link', { name: 'Split' })).toHaveAttribute('href', '/savings?tab=splits');
        openMenu();
        expect(screen.getByRole('menuitem', { name: 'Manage split' })).toHaveAttribute('href', '/savings?tab=splits');
        expect(screen.queryByRole('menuitem', { name: 'Split with partner' })).not.toBeInTheDocument();
    });

    it('offers no Manage split on an unsplit expense', () => {
        renderRow(tx());
        openMenu();

        expect(screen.queryByRole('menuitem', { name: 'Manage split' })).not.toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Split with partner' })).toBeInTheDocument();
    });
});

// The t() stub above echoes the inline fallback, so a mistyped key would still
// pass the render tests; check the keys the row uses exist in both locales.
describe('TransactionRow split text', () => {
    it.each([['en', en], ['zh-TW', zhTW]])('%s has the split badge and Manage split', (_locale, json) => {
        expect(json.splitBadge).toEqual(expect.any(String));
        expect(json.list.manageSplit).toEqual(expect.any(String));
        expect(json.list.manageSplit).not.toBe('');
    });
});
