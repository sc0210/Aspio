/**
 * Replace-mode holding import deletes every existing holding, so it asks first
 * (window.confirm until 2026-10-29, now the in-app confirm). Cancelling must
 * not import; confirming imports with mode 'replace'. Mirrors
 * TransactionImportReplaceConfirm.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { ImportExportModal } from '@/components/portfolio/ImportExportModal';
import pfZh from '@/locales/zh-TW/portfolio.json';
import commonZh from '@/locales/zh-TW/common.json';

jest.mock('react-hot-toast', () => {
  const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, default: toast };
});

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'zh-TW',
  ns: ['portfolio', 'common'],
  defaultNS: 'portfolio',
  resources: { 'zh-TW': { portfolio: pfZh, common: commonZh } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const CSV = [
  'Symbol,Name,Type,Quantity,Average Cost,Currency,Exchange,Sector,Purchase Date',
  'VT,Vanguard Total World,etf,10,100,USD,NYSE,,2026-01-02',
].join('\n');

const existing = [
  { id: 'old-1', symbol: '0050', name: 'Yuanta Taiwan 50', type: 'etf', quantity: 1, averageCost: 100, currentPrice: 100, currency: 'TWD', exchange: 'TWSE' },
] as unknown as React.ComponentProps<typeof ImportExportModal>['holdings'];

const reachConfirm = async () => {
  const onImport = jest.fn().mockResolvedValue(undefined);
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ImportExportModal holdings={existing} onClose={jest.fn()} onImport={onImport} />
    </I18nextProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  // jsdom's File has no text(), which the modal reads the upload with.
  const file = Object.assign(new File([CSV], 'holdings.csv', { type: 'text/csv' }), { text: async () => CSV });
  fireEvent.change(input, { target: { files: [file] } });
  const importButton = await screen.findByRole('button', { name: /Import 1 Lot/ });
  fireEvent.click(container.querySelector('input[type="radio"][value="replace"]') as HTMLInputElement);
  fireEvent.click(importButton);
  return onImport;
};

describe('ImportExportModal replace confirm', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not import when the replace confirm is cancelled', async () => {
    const onImport = await reachConfirm();
    const confirm = screen.getByRole('dialog', { name: pfZh.importReplaceConfirm.title });
    expect(within(confirm).getByText(/1 筆持股，並以 1 筆新持股取代/)).toBeInTheDocument();

    // the import modal behind has its own Cancel
    fireEvent.click(within(confirm).getByRole('button', { name: commonZh.common.cancel }));

    expect(screen.queryByRole('dialog', { name: pfZh.importReplaceConfirm.title })).not.toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('imports in replace mode once confirmed', async () => {
    const onImport = await reachConfirm();
    fireEvent.click(screen.getByRole('button', { name: pfZh.importReplaceConfirm.confirm }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][1]).toBe('replace');
  });
});
