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
    // Loan sits under the Others group.
    renderFields(form({ category: 'Others' }), { onChange });
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

  it('shows a category it does not list as its own chip, which is not a control', () => {
    renderFields(form({ category: 'Education' }));
    // Shown, so the row reads as what it is; not a toggle, since it does nothing when pressed.
    expect(screen.getByText('Education')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Education/ })).not.toBeInTheDocument();
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

describe('CashFields — the optional detail under a category', () => {
  const details = () => screen.queryByRole('group', { name: /Detail/ });

  it('offers no detail until a group is chosen', () => {
    renderFields(form());
    expect(details()).not.toBeInTheDocument();
  });

  it('offers Shopping details, Beauty among them, and picks one', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Shopping' }), { onChange });
    await userEvent.click(within(details()!).getByRole('button', { name: /Beauty/ }));
    expect(onChange).toHaveBeenCalledWith('subcategory', 'Beauty');
  });

  it('clears the chosen detail when it is tapped again', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Shopping', subcategory: 'Beauty' }), { onChange });
    const beauty = within(details()!).getByRole('button', { name: /Beauty/ });
    expect(beauty).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(beauty);
    expect(onChange).toHaveBeenCalledWith('subcategory', '');
  });

  it('drops the detail when the category changes, so Beauty never rides along to Dining', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Shopping', subcategory: 'Beauty' }), { onChange });
    await userEvent.click(screen.getByRole('button', { name: /^Food$/ }));
    expect(onChange).toHaveBeenCalledWith('subcategory', '');
    expect(onChange).toHaveBeenCalledWith('category', 'Dining');
  });

  it('shows a detail this form does not list, but not as a chip a tap could erase', () => {
    renderFields(form({ category: 'Shopping', subcategory: 'Books' }));
    expect(details()).toHaveTextContent('Books');
    expect(within(details()!).queryByRole('button', { name: /Books/ })).not.toBeInTheDocument();
  });
});

describe('CashFields — expense groups first, finer choices optional', () => {
  const details = () => screen.queryByRole('group', { name: /Detail/ });
  const tile = (name: RegExp) => screen.getByRole('button', { name });

  it('shows six groups for an expense, not every category', () => {
    renderFields(form());
    const grid = screen.getByRole('group', { name: /Category/ });
    const labels = within(grid).getAllByRole('button').map((b) => b.lastElementChild?.textContent);
    expect(labels).toEqual(['Food', 'Housing', 'Transport', 'Shopping', 'Fun', 'Others']);
  });

  it('saves a group on its own as its category, one tap', async () => {
    const onChange = jest.fn();
    renderFields(form(), { onChange });
    await userEvent.click(tile(/^Housing$/));
    expect(onChange).toHaveBeenCalledWith('category', 'Housing');
  });

  it('marks the group of a stored category and offers its finer choices', () => {
    renderFields(form({ category: 'Utilities' }));
    expect(tile(/^Housing$/)).toHaveAttribute('aria-pressed', 'true');
    expect(within(details()!).getByRole('button', { name: /Utilities/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(details()!).getByRole('button', { name: /Rent/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('refines within the group: Food → Groceries', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Dining' }), { onChange });
    await userEvent.click(within(details()!).getByRole('button', { name: /Groceries/ }));
    expect(onChange).toHaveBeenCalledWith('category', 'Groceries');
  });

  it('goes back to the group when the chosen finer choice is tapped again', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Groceries' }), { onChange });
    await userEvent.click(within(details()!).getByRole('button', { name: /Groceries/ }));
    expect(onChange).toHaveBeenCalledWith('category', 'Dining');
  });

  it('keeps the finer choice when its own group is tapped again', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Groceries' }), { onChange });
    await userEvent.click(tile(/^Food$/));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers Transport details: public transit, maintenance, parking, car rental', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Transportation' }), { onChange });
    const names = within(details()!).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['🚇Public transit', '🔧Maintenance', '🅿️Parking', '🚙Car rental']);
    await userEvent.click(within(details()!).getByRole('button', { name: /Parking/ }));
    expect(onChange).toHaveBeenCalledWith('subcategory', 'Parking');
  });

  it('offers Insurance under Others', async () => {
    const onChange = jest.fn();
    renderFields(form({ category: 'Others' }), { onChange });
    await userEvent.click(within(details()!).getByRole('button', { name: /Insurance/ }));
    expect(onChange).toHaveBeenCalledWith('category', 'Insurance');
  });

  it('keeps income a flat list', () => {
    renderFields(form({ type: 'income' }));
    expect(screen.getByRole('button', { name: /Salary/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Food$/ })).not.toBeInTheDocument();
  });
});
