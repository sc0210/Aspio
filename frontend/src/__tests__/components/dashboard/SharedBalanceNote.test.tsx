/**
 * The dashboard note that explains why the cash wallets differ from the bank
 * while shared bills are open (each ledger holds only its owner's share).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SharedBalanceNote } from '@/components/dashboard/SharedBalanceNote';
import type { PeerBalanceOut } from '@/shared/types';

jest.mock('react-i18next', () => {
  const t = (key: string, fallback?: string, vars?: Record<string, string>) =>
    (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars?.[k] ?? '');
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t }) };
});

let mockBalances: PeerBalanceOut[] | undefined;
jest.mock('@/hooks/useSplitBalances', () => ({ useSplitBalances: () => ({ data: mockBalances }) }));

let mockVisible = true;
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: mockVisible }) }));

const balance = (name: string, net: number, currency = 'TWD'): PeerBalanceOut => ({
  connection_id: `c-${name}`, partner_name: name, balances: [{ currency, net }],
});

beforeEach(() => { mockVisible = true; });

it('renders nothing while nobody owes anything', () => {
  mockBalances = [{ connection_id: 'c1', partner_name: 'Bob', balances: [] }, balance('Amy', 0)];
  const { container } = render(<SharedBalanceNote />);
  expect(container).toBeEmptyDOMElement();
});

it('names each balance and says the wallets read higher than the bank', () => {
  mockBalances = [balance('Bob', 400), balance('Amy', -240)];
  render(<SharedBalanceNote />);
  expect(screen.getByText(/Bob owes you NT\$400/)).toBeInTheDocument();
  expect(screen.getByText(/You owe Amy NT\$240/)).toBeInTheDocument();
  // 400 owed to you less 240 you owe: the wallets read 160 above the bank.
  expect(screen.getByText(/read NT\$160 more than your bank/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Settle up/ })).toHaveAttribute('href', '/savings?tab=splits');
});

it('says the wallets read lower when you owe more than you are owed', () => {
  mockBalances = [balance('Amy', -240)];
  render(<SharedBalanceNote />);
  expect(screen.getByText(/read NT\$240 less than your bank/)).toBeInTheDocument();
});

it('keeps currencies apart', () => {
  mockBalances = [balance('Bob', 400), balance('Amy', 30, 'USD')];
  render(<SharedBalanceNote />);
  expect(screen.getByText(/NT\$400 more/)).toBeInTheDocument();
  expect(screen.getByText(/\$30(\.00)? more/)).toBeInTheDocument();
});

it('hides amounts when values are hidden', () => {
  mockVisible = false;
  mockBalances = [balance('Bob', 400)];
  render(<SharedBalanceNote />);
  expect(screen.getByText(/Bob owes you •••/)).toBeInTheDocument();
  expect(screen.queryByText(/400/)).not.toBeInTheDocument();
});
