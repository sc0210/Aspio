/**
 * What the add/edit form shows up front and what it tucks into "More options".
 *
 * The essentials stay visible; the loan link, payment method and tags are
 * collapsed. Two rules keep that from hiding anything that matters: a loan picker
 * shows inline when the category is Loan Payment (and stays reachable from More
 * options for any other expense, since a loan is paid down by the link, not the
 * category), and a closed section names what is set inside it.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CashFields, type CashFormData } from '@/components/transactions/TransactionFormFields';

jest.mock('react-i18next', () => ({
  // formatters pulls in the i18n setup, which registers this plugin.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const LOANS = [{ id: 'loan-1', name: 'Car loan', current_balance: 100000, currency: 'TWD' }];

function form(overrides: Partial<CashFormData> = {}): CashFormData {
  return {
    type: 'expense', amount: '', currency: 'TWD', description: '', category: '',
    paymentMethod: '', walletType: 'life', fromWallet: 'life', toWallet: 'emergency',
    date: '2026-10-31', tags: [], loanId: '', ...overrides,
  };
}

function renderFields(data: CashFormData, { onChange = jest.fn(), loans = LOANS } = {}) {
  return render(
    <CashFields idPrefix="t" formData={data} errors={{}} onChange={onChange} onTagsChange={jest.fn()} activeLoans={loans} />,
  );
}

const moreToggle = () => screen.getByRole('button', { name: /More options/ });

describe('CashFields — essentials up front, the rest under More options', () => {
  it('starts collapsed on a new entry, with the optional fields out of view', () => {
    renderFields(form());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Payment Method' })).not.toBeInTheDocument();
    // Hidden, not unmounted (a half-typed tag survives closing), so query by role,
    // which skips hidden elements.
    expect(screen.queryByRole('textbox', { name: 'Tags' })).not.toBeInTheDocument();
  });

  it('opens on click and shows payment method and tags', async () => {
    renderFields(form());
    await userEvent.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Payment Method' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeInTheDocument();
  });

  it('opens by itself when an edited transaction already has a payment method or tags', () => {
    renderFields(form({ paymentMethod: 'credit_card', tags: ['travel'] }));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('names what is set inside while closed', async () => {
    renderFields(form({ paymentMethod: 'credit_card', tags: ['travel'] }));
    await userEvent.click(moreToggle()); // close it
    expect(moreToggle()).toHaveTextContent('Credit Card');
    expect(moreToggle()).toHaveTextContent('#travel');
  });
});

describe('CashFields — the loan picker', () => {
  it('shows inline for a Loan Payment expense', () => {
    renderFields(form({ category: 'Loan Payment' }));
    // Visible without opening More options.
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('group', { name: 'Link to Loan' })).toBeInTheDocument();
  });

  it('is not up front for other expenses, but can still be reached from More options', async () => {
    renderFields(form({ category: 'Housing' }));
    expect(screen.queryByRole('group', { name: 'Link to Loan' })).not.toBeInTheDocument();
    await userEvent.click(moreToggle());
    expect(screen.getByRole('group', { name: 'Link to Loan' })).toBeInTheDocument();
  });

  it('opens More options for an expense already linked under another category', () => {
    renderFields(form({ category: 'Housing', loanId: 'loan-1' }));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Car loan/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is never offered for income', () => {
    renderFields(form({ type: 'income', category: 'Salary' }));
    expect(screen.queryByRole('group', { name: 'Link to Loan' })).not.toBeInTheDocument();
  });
});

describe('CashFields — guarding against easy mistakes', () => {
  it('links the only loan when Loan Payment is picked', async () => {
    const onChange = jest.fn();
    renderFields(form(), { onChange });
    await userEvent.click(screen.getByRole('button', { name: /Loan/ }));
    expect(onChange).toHaveBeenCalledWith('category', 'Loan Payment');
    expect(onChange).toHaveBeenCalledWith('loanId', 'loan-1');
  });

  it('asks for a loan when there are several and none is picked', () => {
    const loans = [...LOANS, { id: 'loan-2', name: 'Mortgage', current_balance: 5, currency: 'TWD' }];
    renderFields(form({ category: 'Loan Payment' }), { loans });
    expect(screen.getByText(/Pick the loan this repays/)).toBeInTheDocument();
  });

  it('points to Loans when Loan Payment is picked with no loan to link', () => {
    renderFields(form({ category: 'Loan Payment' }), { loans: [] });
    expect(screen.getByRole('link', { name: /Add one on Loans/ })).toHaveAttribute('href', '/loans');
  });

  it('shows a category it does not list as a pressed chip of its own', () => {
    renderFields(form({ category: 'Insurance' }));
    expect(screen.getByRole('button', { name: /Insurance/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the two sides of a transfer different: picking From sets To to the other wallet', async () => {
    const onChange = jest.fn();
    renderFields(form({ type: 'transfer' }), { onChange });
    const from = screen.getByRole('group', { name: 'From Wallet' });
    await userEvent.click(within(from).getByRole('button', { name: 'Emergency Wallet' }));
    expect(onChange).toHaveBeenCalledWith('fromWallet', 'emergency');
    expect(onChange).toHaveBeenCalledWith('toWallet', 'life');
  });

  it('offers no More options on a transfer, whose tags the transfer API would drop', () => {
    renderFields(form({ type: 'transfer' }));
    expect(screen.queryByRole('button', { name: /More options/ })).not.toBeInTheDocument();
  });

  it('lets a payment method be cleared again', async () => {
    const onChange = jest.fn();
    renderFields(form({ paymentMethod: 'cash' }), { onChange });
    await userEvent.click(screen.getByRole('button', { name: /Not set/ }));
    expect(onChange).toHaveBeenCalledWith('paymentMethod', '');
  });
});
