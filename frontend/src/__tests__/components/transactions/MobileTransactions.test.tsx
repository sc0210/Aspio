/**
 * The phone transactions view reaches receipt scanning.
 *
 * /transactions/scan had no link from anywhere; the desktop toolbar got one,
 * but the phone renders its own header — and the phone is where a receipt is
 * photographed.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MobileTransactions } from '@/components/transactions/MobileTransactions';

jest.mock('@/hooks/useTransactions', () => ({
  useTransactions: () => ({ transactions: [], isLoading: false }),
}));

jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true }),
}));

jest.mock('@/components/dashboard/BiggerScreenHint', () => ({
  BiggerScreenHint: () => null,
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k),
    i18n: { language: 'en' },
  }),
}));

describe('MobileTransactions header', () => {
  it('links to receipt scanning beside adding a transaction', () => {
    render(<MobileTransactions />);

    expect(screen.getByRole('link', { name: 'Scan Receipt' })).toHaveAttribute('href', '/transactions/scan');
    expect(screen.getByRole('link', { name: 'Add transaction' })).toHaveAttribute('href', '/transactions/add');
  });
});
