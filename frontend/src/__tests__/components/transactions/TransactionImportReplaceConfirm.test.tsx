/**
 * Replace-mode import deletes every existing transaction, so it asks first
 * (window.confirm until 2026-10-29, now the in-app confirm). Cancelling must
 * not import; confirming imports with mode 'replace'.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { TransactionImportExportModal } from '@/components/transactions/TransactionImportExportModal';
import txEn from '@/locales/en/transactions.json';
import commonEn from '@/locales/en/common.json';
import type { Transaction } from '@/shared/types';

jest.mock('react-hot-toast', () => {
  const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, default: toast };
});

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'en',
  ns: ['transactions', 'common'],
  defaultNS: 'transactions',
  resources: { en: { transactions: txEn, common: commonEn } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const CSV = [
  'Date,Type,Amount,Currency,Category,Description,Payment Method,Tags',
  '2026-10-01,expense,150,TWD,Food,Lunch,Cash,',
].join('\n');

const existing = [{ id: 'old-1', date: '2026-01-01', amount: 99, category: 'Food', type: 'expense' }] as unknown as Transaction[];

const reachConfirm = async () => {
  const onImport = jest.fn().mockResolvedValue(undefined);
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <TransactionImportExportModal transactions={existing} onClose={jest.fn()} onImport={onImport} />
    </I18nextProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([CSV], 'tx.csv', { type: 'text/csv' })] } });
  const importButton = await screen.findByRole('button', { name: /Import 1 Transactions/ });
  fireEvent.click(container.querySelector('input[type="radio"][value="replace"]') as HTMLInputElement);
  fireEvent.click(importButton);
  return onImport;
};

describe('TransactionImportExportModal replace confirm', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not import when the replace confirm is cancelled', async () => {
    const onImport = await reachConfirm();
    const confirm = screen.getByRole('dialog', { name: txEn.importExport.replaceConfirm.title });
    expect(within(confirm).getByText(/DELETE all 1 existing transactions and replace them with 1 new/)).toBeInTheDocument();

    // the import modal behind has its own Cancel
    fireEvent.click(within(confirm).getByRole('button', { name: commonEn.common.cancel }));

    expect(screen.queryByRole('dialog', { name: txEn.importExport.replaceConfirm.title })).not.toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('imports in replace mode once confirmed', async () => {
    const onImport = await reachConfirm();
    fireEvent.click(screen.getByRole('button', { name: txEn.importExport.replaceConfirm.confirm }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][1]).toBe('replace');
  });
});
