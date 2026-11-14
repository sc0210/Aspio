/**
 * Picking a symbol from the buy modal's search sets the currency it trades in.
 *
 * The search list (popular symbols) carries a market but no currency, and the
 * modal fell back to TWD and TWSE: VOO was bought as if priced in NT$.
 * Portfolios are TWD, but a holding keeps its own currency.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BuyHoldingModal } from '@/components/portfolio/BuyHoldingModal';
import { listingDefaults } from '@/lib/portfolio/holdingFormOptions';

jest.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

let mockDemo = false;
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => ({ isDemo: mockDemo }) }));

const mockSearch = jest.fn();
const mockQuote = jest.fn();
jest.mock('@/services/symbolService', () => ({
  __esModule: true,
  default: {
    searchSymbol: (...a: unknown[]) => mockSearch(...a),
    getQuote: (...a: unknown[]) => mockQuote(...a),
  },
}));

describe('listingDefaults', () => {
  it.each([
    ['US', { currency: 'USD' }],
    ['CRYPTO', { currency: 'USD', exchange: 'CRYPTO' }],
    ['TW', { currency: 'TWD', exchange: 'TWSE' }],
    [undefined, { currency: 'TWD', exchange: 'TWSE' }],
  ])('%s', (market, expected) => {
    expect(listingDefaults(market)).toEqual(expected);
  });
});

async function pick(symbol: string, market: string) {
  mockSearch.mockResolvedValue({ success: true, data: [{ symbol, name: `${symbol} name`, type: 'etf', market }] });
  render(<BuyHoldingModal isOpen onClose={jest.fn()} onBuy={jest.fn()} />);
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText('buy.searchPlaceholder'), { target: { value: symbol } });
  fireEvent.click(await screen.findByText(`${symbol} name`));
  await act(async () => {});
}

beforeEach(() => {
  mockDemo = false;
  mockSearch.mockReset();
  mockQuote.mockReset();
});

it('a US pick is bought in USD, with the exchange and price from its quote', async () => {
  mockQuote.mockResolvedValue({ status: 'success', exchange: 'NYSE', currency: 'USD', current_price: 600 });
  await pick('VOO', 'US');

  expect(screen.getByLabelText('buy.field.currency')).toHaveValue('USD');
  await waitFor(() => expect(screen.getByLabelText('buy.field.exchange')).toHaveValue('NYSE'));
  expect(screen.getByLabelText('buy.field.price')).toHaveValue(600);
  expect(mockQuote).toHaveBeenCalledWith('VOO', 'US');
});

it('a TW pick stays in TWD on TWSE', async () => {
  mockQuote.mockResolvedValue({ status: 'success', exchange: 'TWSE', currency: 'TWD', current_price: 102.5 });
  await pick('0050', 'TW');

  expect(screen.getByLabelText('buy.field.currency')).toHaveValue('TWD');
  expect(screen.getByLabelText('buy.field.exchange')).toHaveValue('TWSE');
});

it('a failed quote leaves the fields editable, still in USD', async () => {
  mockQuote.mockRejectedValue(new Error('offline'));
  await pick('AAPL', 'US');

  expect(screen.getByLabelText('buy.field.currency')).toHaveValue('USD');
  expect(screen.getByLabelText('buy.field.exchange')).toHaveValue('');
});

it('a slow quote for an earlier pick does not fill the next one', async () => {
  let resolveVoo: (q: unknown) => void = () => {};
  mockQuote.mockImplementation((sym: string) =>
    sym === 'VOO'
      ? new Promise((resolve) => { resolveVoo = resolve; })
      : Promise.reject(new Error('offline')));
  mockSearch.mockResolvedValue({
    success: true,
    data: [
      { symbol: 'VOO', name: 'VOO name', type: 'etf', market: 'US' },
      { symbol: 'AAPL', name: 'AAPL name', type: 'stock', market: 'US' },
    ],
  });
  render(<BuyHoldingModal isOpen onClose={jest.fn()} onBuy={jest.fn()} />);
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText('buy.searchPlaceholder'), { target: { value: 'VO' } });
  fireEvent.click(await screen.findByText('VOO name'));
  // Back to search (the reset), then AAPL, before VOO's quote lands.
  fireEvent.click(screen.getByText('buy.back'));
  fireEvent.change(screen.getByPlaceholderText('buy.searchPlaceholder'), { target: { value: 'AA' } });
  fireEvent.click(await screen.findByText('AAPL name'));
  await act(async () => { resolveVoo({ status: 'success', exchange: 'NYSE', current_price: 600 }); });

  expect(screen.getByLabelText('buy.field.exchange')).toHaveValue('');
  expect(screen.getByLabelText('buy.field.price')).not.toHaveValue(600);
});

it('demo mode does not ask the backend for a quote', async () => {
  mockDemo = true;
  await pick('VOO', 'US');
  expect(screen.getByLabelText('buy.field.currency')).toHaveValue('USD');
  expect(mockQuote).not.toHaveBeenCalled();
});
