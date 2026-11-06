import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewSplitModal from '@/components/savings/NewSplitModal';
import { apiClient } from '@/lib/api-client';
import { transactionService } from '@/services/transactionService';
import type { PeerConnectionOut } from '@/shared/types';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, string>, vars?: Record<string, string>) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values = (typeof fallback === 'object' ? fallback : vars) ?? {};
      return text.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
    },
  }),
}));
jest.mock('@/lib/api-client', () => ({ apiClient: { createSplit: jest.fn() } }));
jest.mock('@/services/transactionService', () => ({ transactionService: { getCategories: jest.fn() } }));

const conn: PeerConnectionOut = {
  id: 'conn-1', other_user: { id: 'u2', name: 'Bob', username: 'bob', avatar_url: null },
  status: 'accepted', direction: 'sent', created_at: '2026-05-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (transactionService.getCategories as jest.Mock).mockResolvedValue({ data: [
    { id: 'pay', name: 'Salary', type: 'income' },
    { id: 'food', name: 'Food', type: 'expense' },
  ] });
});

it('sends a fixed split Bob paid, with only expense categories offered', async () => {
  (apiClient.createSplit as jest.Mock).mockResolvedValue({ data: {} });
  const onSuccess = jest.fn();
  render(<NewSplitModal isOpen onClose={jest.fn()} onSuccess={onSuccess} connections={[conn]} />);

  await waitFor(() => expect(screen.getByRole('option', { name: 'Food' })).toBeInTheDocument());
  expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('What was it?'), { target: { value: 'Groceries' } });
  fireEvent.change(screen.getByLabelText('Total'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bob paid' }));
  fireEvent.click(screen.getByRole('button', { name: 'Amount' }));
  fireEvent.change(screen.getByLabelText('My share'), { target: { value: '300' } });
  expect(screen.getByText('You: 300.00 · Bob: 700.00')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Split the bill' }));
  await waitFor(() => expect(apiClient.createSplit).toHaveBeenCalledWith(expect.objectContaining({
    connection_id: 'conn-1', description: 'Groceries', total_amount: 1000, currency: 'TWD',
    category_id: 'food', payer: 'partner', method: 'fixed', my_amount: 300, my_percent: null,
  })));
  expect(onSuccess).toHaveBeenCalled();
});

it('blocks a share larger than the total', async () => {
  render(<NewSplitModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} connections={[conn]} />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('What was it?'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Total'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Amount' }));
  fireEvent.change(screen.getByLabelText('My share'), { target: { value: '150' } });

  expect(screen.getByText('Your share has to be between 0 and the total.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Split the bill' })).toBeDisabled();
});
