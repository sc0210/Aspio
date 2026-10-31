'use client';

/**
 * The cash-transaction fields shared by /transactions/add and
 * /transactions/edit/[id]: one copy, so a fix or a translation lands in both.
 * Each page keeps its own investment sub-form, which really does differ.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import { getCategoryColorGroup } from './categoryColorGroups';

export const TRANSACTION_TYPES: { value: string; label: string; shortLabel?: string; color: string }[] = [
  { value: 'expense',    label: 'Expense',    color: 'red'    },
  { value: 'income',     label: 'Income',     color: 'green'  },
  { value: 'transfer',   label: 'Transfer',   color: 'blue'   },
  { value: 'investment', label: 'Investment', shortLabel: 'Invest', color: 'purple' },
];

// Ordered by the pie's groups (see categoryColorGroups), so chips of one colour sit
// together: food, transport, housing, then everything that lands in "others".
export const CATEGORIES = {
  expense: [
    { value: 'Dining',          label: 'Dining',     icon: '🍽️' },
    { value: 'Groceries',       label: 'Groceries',  icon: '🛒' },
    { value: 'Transportation',  label: 'Transport',  icon: '🚗' },
    { value: 'Housing',         label: 'Housing',    icon: '🏠' },
    { value: 'Utilities',       label: 'Utilities',  icon: '💡' },
    { value: 'Shopping',        label: 'Shopping',   icon: '🛍️' },
    { value: 'Entertainment',   label: 'Fun',        icon: '🎬' },
    { value: 'Healthcare',      label: 'Health',     icon: '🏥' },
    { value: 'Travel',          label: 'Travel',     icon: '✈️' },
    { value: 'Gift',            label: 'Gift',       icon: '🎁' },
    { value: 'Loan Payment',    label: 'Loan',       icon: '💳' },
    { value: 'Others',          label: 'Others',     icon: '📦' },
  ],
  // Salary leads (the income entered most); the one green chip goes last.
  income: [
    { value: 'Salary',             label: 'Salary',     icon: '💼' },
    { value: 'Freelance',          label: 'Freelance',  icon: '💻' },
    { value: 'Gift',               label: 'Gift',       icon: '🎁' },
    { value: 'Others',             label: 'Others',     icon: '💵' },
    { value: 'Investment Returns', label: 'Investment', icon: '📈' },
  ],
};

export const PAYMENT_METHODS = [
  { value: 'cash',           label: 'Cash'          },
  { value: 'credit_card',    label: 'Credit Card'   },
  { value: 'bank_transfer',  label: 'Bank Transfer' },
  { value: 'digital_wallet', label: 'E-Wallet'      },
];

// Life and Emergency are the only cash wallets. The Portfolio wallet holds
// invested assets only — never cash — so it is not a valid wallet for income/
// expense entries OR transfers. To move cash into investments you buy a holding
// (which debits the Life Wallet).
const WALLET_TYPES = [
  { value: 'life',      label: 'Life Wallet'      },
  { value: 'emergency', label: 'Emergency Wallet' },
];

const CURRENCIES = ['TWD', 'USD', 'HKD', 'JPY', 'EUR', 'SGD'];

const LOAN_CATEGORY = 'Loan Payment';

export interface CashFormData {
  type: string;
  amount: string;
  currency: string;
  description: string;
  category: string;
  paymentMethod: string;
  walletType: string;
  fromWallet: string;
  toWallet: string;
  date: string;
  tags: string[];
  loanId: string;
}

export interface ActiveLoan {
  id: string;
  name: string;
  current_balance: number;
  currency: string;
}

type T = ReturnType<typeof useTranslation>['t'];

/** Errors for the cash fields; empty when they are valid. */
export function validateCashFields(formData: CashFormData, t: T): Record<string, string> {
  const errors: Record<string, string> = {};
  const amount = parseFloat(formData.amount);
  if (!formData.amount || isNaN(amount) || amount <= 0) {
    errors.amount = t('transactions:form.errAmount', 'Enter amount');
  }
  // A transfer may go without one: the backend names it "Transfer to X Wallet".
  if (formData.type !== 'transfer' && !formData.description.trim()) {
    errors.description = t('transactions:form.errDescription', 'Add description');
  }
  if (formData.type === 'transfer') {
    if (formData.fromWallet === formData.toWallet) {
      errors.transfer = t('transactions:form.errSameWallet', 'Source and destination wallets must be different');
    }
  } else if (!formData.category) {
    errors.category = t('transactions:form.errCategory', 'Select category');
  }
  return errors;
}

// Shared field chrome. Inputs are text-base below sm: iOS Safari zooms the page
// into any focused input under 16px, which on this form meant every tap.
export const FIELD_LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';
export const FIELD_INPUT = 'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500';

// A choice with more options than fit is one row of chips. On a phone it swipes,
// bleeding to the card edge (-mx-4 against the card's p-4) with the far end faded
// to show it continues. From sm the chips wrap: a mouse cannot swipe, and the
// scrollbar is hidden. scroll-pl matches px, or snapping pulls the first chip
// under the edge; scroll-pr keeps a focused chip clear of the fade. `relative`
// makes the row the chips' offsetParent, for revealSelected.
export const CHIP_ROW = 'relative flex gap-2 overflow-x-auto scrollbar-hide snap-x scroll-pl-4 scroll-pr-10 py-1 -mx-4 px-4 fade-end after:w-6 after:shrink-0 after:content-[""] sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible sm:fade-none sm:after:hidden';
// min-h-11: 44px on touch screens; a laptop keeps the compact chip.
export const CHIP = 'shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 min-h-11 lg:min-h-0 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
export const CHIP_ON = 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-semibold';
export const CHIP_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500';

// A choice of two is a segmented toggle.
export const SEGMENTED = 'inline-flex rounded-lg bg-gray-100 dark:bg-gray-700/60 p-1';
export const SEGMENT = 'rounded-md px-3 py-2 sm:py-1.5 min-h-11 lg:min-h-0 text-sm font-medium transition-colors motion-reduce:transition-none touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
export const SEGMENT_ON = 'bg-white dark:bg-gray-800 text-primary-700 dark:text-primary-300 shadow-sm';
export const SEGMENT_OFF = 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200';

/** The selected chip's mark: a shape, so "chosen" is not carried by colour alone. */
function ChipCheck() {
  return <CheckIcon className="w-4 h-4 shrink-0" aria-hidden="true" />;
}

/**
 * After a failed submit, scroll the topmost visible error into view and focus its
 * field. Topmost on screen, not first in the markup: on a phone the category row
 * sits above the description but after it in the DOM. Runs a frame later, once
 * React has rendered the messages.
 */
export function revealFirstError(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    const alerts = [...(form?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].filter((a) => a.offsetParent !== null);
    if (!form || alerts.length === 0) return;
    const first = alerts.reduce((a, b) => (b.getBoundingClientRect().top < a.getBoundingClientRect().top ? b : a));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    first.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    // The field the message describes, or (for a chip group) its first chip.
    const owner = first.id ? form.querySelector<HTMLElement>(`[aria-describedby~="${first.id}"]`) : null;
    const target = owner?.matches('input, select, textarea, button') ? owner : owner?.querySelector<HTMLElement>('button');
    target?.focus({ preventScroll: true });
  });
}

/**
 * Ref for a chip row: on mount, scroll its selected chip into view (an edited
 * transaction's category can sit past the edge). Sets scrollLeft rather than
 * calling scrollIntoView, which would also scroll the page to the row.
 */
export function revealSelected(row: HTMLDivElement | null) {
  const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (row && chip && chip.offsetLeft + chip.offsetWidth > row.clientWidth) {
    row.scrollLeft = chip.offsetLeft - 16;
  }
}

interface CashFieldsProps {
  /** Prefix for element ids, so labels stay unique per page. */
  idPrefix: string;
  formData: CashFormData;
  errors: Record<string, string>;
  onChange: (field: keyof CashFormData, value: string) => void;
  activeLoans: ActiveLoan[];
  /** The transfer hint points at the Investment tab, which only the add form has. */
  showInvestmentHint?: boolean;
  /** Focus the amount on mount. For a new entry only: on edit it would open the
   *  phone keyboard over a form the user may only want to re-categorise. */
  autoFocusAmount?: boolean;
  onTagsChange: (tags: string[]) => void;
}

/**
 * The essentials (amount, description, date, category, wallet) up front; loan
 * link, payment method and tags behind a collapsed "More options".
 */
export function CashFields({ idPrefix: p, formData, errors, onChange, onTagsChange, activeLoans, showInvestmentHint = false, autoFocusAmount = false }: CashFieldsProps) {
  const { t } = useTranslation(['transactions']);
  const categories = formData.type === 'transfer' ? [] : CATEGORIES[formData.type as keyof typeof CATEGORIES] || [];

  // A loan is paid down by the link, not the category, so a mortgage filed under
  // Housing can still be linked. The picker sits inline for a Loan Payment
  // expense, and in More options for any other expense.
  const loanEligible = formData.type === 'expense' && activeLoans.length > 0;
  const loanInline = loanEligible && formData.category === LOAN_CATEGORY;
  const linkedLoan = activeLoans.find((loan) => loan.id === formData.loanId);
  const payment = PAYMENT_METHODS.find((method) => method.value === formData.paymentMethod);
  // A category this form does not list (an older or imported row) gets its own
  // pressed chip, so an edit shows what the row is and saves it unchanged.
  const unknownCategory = categories.length > 0 && formData.category && !categories.some((c) => c.value === formData.category)
    ? formData.category
    : null;

  // Picking Loan Payment with exactly one loan links it: a repayment that reduces
  // no balance is the mistake to avoid.
  const pickCategory = (value: string) => {
    onChange('category', value);
    if (value === LOAN_CATEGORY && formData.type === 'expense' && !formData.loanId && activeLoans.length === 1) {
      onChange('loanId', activeLoans[0].id);
    }
  };

  // Each side of a transfer: picking one wallet puts the other on the far side,
  // so the two can never match.
  const pickTransferWallet = (side: 'fromWallet' | 'toWallet', wallet: string) => {
    onChange(side, wallet);
    const other = WALLET_TYPES.find((w) => w.value !== wallet)?.value;
    if (other) onChange(side === 'fromWallet' ? 'toWallet' : 'fromWallet', other);
  };

  // Open from the start when it already holds something, as on edit (the edit page
  // mounts this only once the transaction has loaded).
  const [moreOpen, setMoreOpen] = useState(
    () => !!formData.paymentMethod || formData.tags.length > 0 || (!!formData.loanId && formData.category !== LOAN_CATEGORY)
  );
  const moreSummary = [
    ...(payment ? [t(`transactions:form.paymentMethods.${payment.value}`, payment.label)] : []),
    ...(linkedLoan && !loanInline ? [linkedLoan.name] : []),
    ...formData.tags.map((tag) => `#${tag}`),
  ];

  const loanPicker = (
    <div>
      <div id={`${p}-group-loan`} className={FIELD_LABEL}>
        {t('transactions:form.linkToLoan', 'Link to Loan')}
      </div>
      <div role="group" aria-labelledby={`${p}-group-loan`} ref={revealSelected} className={CHIP_ROW}>
        <button
          aria-pressed={!formData.loanId}
          type="button"
          onClick={() => onChange('loanId', '')}
          className={cn(CHIP, !formData.loanId ? CHIP_ON : CHIP_OFF)}
        >
          {!formData.loanId && <ChipCheck />}
          {t('transactions:form.loanNone', 'None')}
        </button>
        {activeLoans.map(loan => (
          <button
            aria-pressed={formData.loanId === loan.id}
            key={loan.id}
            type="button"
            onClick={() => onChange('loanId', loan.id)}
            className={cn(CHIP, formData.loanId === loan.id ? CHIP_ON : CHIP_OFF)}
          >
            {formData.loanId === loan.id && <ChipCheck />}
            {loan.name}
            <span className="font-normal opacity-70">{formatCurrency(loan.current_balance, loan.currency, { precision: 0 })}</span>
          </button>
        ))}
      </div>
      {loanInline && !formData.loanId && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
          {t('transactions:form.loanPickHint', "Pick the loan this repays, or no loan balance goes down.")}
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Amount, description and date are what gets typed: one row on a laptop,
          right under the type, with the category grid below. On a phone the
          grid sits between the amount and the description instead. The DOM
          follows the laptop order, so Tab and the phone keyboard's "next" go
          amount -> description. */}
      <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-x-3">
        {/* Amount */}
        <div className="order-1 lg:order-none">
          <label htmlFor={`${p}-amount`} className={FIELD_LABEL}>{t('transactions:fields.amount', 'Amount')}</label>
          <div className={cn(
            'flex items-center gap-2 rounded-xl border-2 px-2 py-1.5 lg:h-11 lg:py-0 focus-within:border-primary-500 dark:focus-within:border-primary-400',
            errors.amount ? 'border-error-400' : 'border-gray-200 dark:border-gray-600'
          )}>
            <select
              value={formData.currency}
              onChange={(e) => onChange('currency', e.target.value)}
              className="shrink-0 bg-gray-100 dark:bg-gray-700 rounded-lg px-2 py-2 text-base sm:text-sm font-bold text-gray-700 dark:text-gray-200 border-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              aria-label={t('transactions:form.currency', 'Currency')}
            >
              {CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? `${p}-amount-error` : undefined}
              id={`${p}-amount`}
              type="number"
              inputMode="decimal"
              onWheel={(e) => e.currentTarget.blur()}
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(e) => onChange('amount', e.target.value)}
              placeholder="0"
              className={cn(
                'flex-1 min-w-0 py-1 text-3xl sm:text-2xl lg:text-xl font-bold tabular-nums bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:ring-0',
                errors.amount && 'text-error-700 dark:text-error-500'
              )}
              autoFocus={autoFocusAmount}
            />
          </div>
          {errors.amount && <p id={`${p}-amount-error`} role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.amount}</p>}
        </div>

        {/* Description + Date: one row, unless the phone is too narrow to give the description room */}
        <div className="order-3 lg:order-none grid grid-cols-1 min-[360px]:grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-3">
          <div>
            <label htmlFor={`${p}-description`} className={FIELD_LABEL}>{t('transactions:fields.description', 'Description')}</label>
            <input
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? `${p}-description-error` : undefined}
              id={`${p}-description`}
              type="text"
              value={formData.description}
              onChange={(e) => onChange('description', e.target.value)}
              placeholder={t('transactions:form.descriptionPlaceholder', "What's this for?")}
              enterKeyHint="done"
              className={cn(FIELD_INPUT, 'lg:h-11', errors.description && 'border-error-400')}
            />
            {errors.description && <p id={`${p}-description-error`} role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.description}</p>}
          </div>
          <div className="min-[360px]:w-[8.75rem] sm:w-40">
            <label htmlFor={`${p}-date`} className={FIELD_LABEL}>{t('transactions:fields.date', 'Date')}</label>
            <input
              id={`${p}-date`}
              type="date"
              value={formData.date}
              onChange={(e) => onChange('date', e.target.value)}
              className={cn(FIELD_INPUT, 'px-2 min-h-[2.75rem] sm:min-h-0 lg:h-11')}
            />
          </div>
        </div>

        {/* Category (income / expense) */}
        {formData.type !== 'transfer' && (
          <div className="order-2 lg:order-none lg:col-span-2">
            <div id={`${p}-group-category`} className={FIELD_LABEL}>
              {t('transactions:form.categoryLabel', 'Category')} {errors.category && <span className="text-error-700 dark:text-error-500 text-xs">*</span>}
            </div>
            <div
              role="group"
              aria-labelledby={`${p}-group-category`}
              aria-describedby={errors.category ? `${p}-category-error` : undefined}
              ref={revealSelected}
              className={CHIP_ROW}
            >
              {unknownCategory && (
                <button
                  aria-pressed={true}
                  type="button"
                  className={cn(CHIP, 'font-semibold', getCategoryColorGroup(unknownCategory).lightBg, getCategoryColorGroup(unknownCategory).lightText, getCategoryColorGroup(unknownCategory).borderOn)}
                >
                  <ChipCheck />
                  {unknownCategory}
                </button>
              )}
              {categories.map((category) => {
                const isSelected = formData.category === category.value;
                // Outlined in the colour of the pie slice this category lands in,
                // filled with it once chosen.
                const group = getCategoryColorGroup(category.value);
                return (
                  <button
                    aria-pressed={isSelected}
                    key={category.value}
                    type="button"
                    onClick={() => pickCategory(category.value)}
                    className={cn(
                      CHIP,
                      isSelected
                        ? cn('font-semibold', group.lightBg, group.lightText, group.borderOn)
                        : cn('bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300', group.border)
                    )}
                  >
                    {/* A fixed slot: emoji glyphs render wider than their box and crowd the label. */}
                    {isSelected
                      ? <span className="w-5 flex justify-center"><ChipCheck /></span>
                      : <span aria-hidden="true" className="w-5 text-center leading-none">{category.icon}</span>}
                    {t(`transactions:form.categories.${category.value}`, category.label)}
                  </button>
                );
              })}
            </div>
            {errors.category && <p id={`${p}-category-error`} className="text-sm text-error-700 dark:text-error-500 mt-1" role="alert">{errors.category}</p>}
            {/* Loan Payment with no loan to link: say where loans come from. */}
            {formData.type === 'expense' && formData.category === LOAN_CATEGORY && activeLoans.length === 0 && (
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t('transactions:form.noActiveLoans', 'No active loans to link.')}{' '}
                <Link href="/loans" className="font-medium text-primary-700 dark:text-primary-400 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                  {t('transactions:form.addLoanLink', 'Add one on Loans')}
                </Link>
              </p>
            )}
          </div>
        )}

        {/* Transfer wallet selection: From → To side by side */}
        {formData.type === 'transfer' && (
          <div className="order-2 lg:order-none lg:col-span-2 space-y-3">
            {showInvestmentHint && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs">
                <span className="text-base">💡</span>
                <span>{t('transactions:form.transferHint.use', 'Use')} <strong>{t('transactions:form.types.transfer', 'Transfer')}</strong> {t('transactions:form.transferHint.mid', 'to move cash between wallets. To buy or sell assets, use the')} <strong>{t('transactions:form.types.investment', 'Investment')}</strong> {t('transactions:form.transferHint.end', 'tab instead.')}</span>
              </div>
            )}
            {(['fromWallet', 'toWallet'] as const).map((side) => (
              <div key={side} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span id={`${p}-group-${side}`} className="min-w-16 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {side === 'fromWallet' ? t('transactions:form.fromWallet', 'From Wallet') : t('transactions:form.toWallet', 'To Wallet')}
                </span>
                <div role="group" aria-labelledby={`${p}-group-${side}`} className={SEGMENTED}>
                  {WALLET_TYPES.map((wallet) => {
                    const isSelected = formData[side] === wallet.value;
                    return (
                      <button
                        aria-pressed={isSelected}
                        key={wallet.value}
                        type="button"
                        onClick={() => pickTransferWallet(side, wallet.value)}
                        className={cn(
                          SEGMENT,
                          // Money leaves the From wallet and arrives in the To wallet.
                          isSelected
                            ? side === 'fromWallet'
                              ? 'bg-white dark:bg-gray-800 shadow-sm text-expense-700 dark:text-expense-300'
                              : 'bg-white dark:bg-gray-800 shadow-sm text-income-700 dark:text-income-300'
                            : SEGMENT_OFF
                        )}
                      >
                        {t(`transactions:form.wallets.${wallet.value}`, wallet.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {errors.transfer && <p role="alert" className="text-sm text-error-700 dark:text-error-500 text-center">{errors.transfer}</p>}
          </div>
        )}
      </div>

      {/* Loan picker inline only where it is the point: a Loan Payment expense. */}
      {loanInline && loanPicker}

      {/* Wallet: a small toggle, not two cards. It is Life for almost every entry. */}
      {formData.type !== 'transfer' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id={`${p}-group-wallet-type`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('transactions:form.walletTypeLabel', 'Wallet Type')}
          </span>
          <div role="group" aria-labelledby={`${p}-group-wallet-type`} className={SEGMENTED}>
            {WALLET_TYPES.map((wallet) => {
              const isSelected = formData.walletType === wallet.value;
              return (
                <button
                  aria-pressed={isSelected}
                  key={wallet.value}
                  type="button"
                  onClick={() => onChange('walletType', wallet.value)}
                  className={cn(SEGMENT, isSelected ? SEGMENT_ON : SEGMENT_OFF)}
                >
                  {t(`transactions:form.wallets.${wallet.value}`, wallet.label)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Everything optional, collapsed. While closed, chips say what is set inside,
          so nothing chosen is out of sight. Not for a transfer: its only optional
          field would be tags, which the transfer API does not store. */}
      {formData.type !== 'transfer' && (
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={`${p}-more`}
            onClick={() => setMoreOpen((open) => !open)}
            className="flex w-full min-w-0 min-h-11 items-center gap-2 rounded-lg py-1 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ChevronRightIcon className={cn('w-4 h-4 shrink-0 transition-transform motion-reduce:transition-none', moreOpen && 'rotate-90')} aria-hidden="true" />
            <span className="shrink-0">{t('transactions:form.moreOptions', 'More options')}</span>
            {!moreOpen && moreSummary.length > 0 && (
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {moreSummary.map((chip) => (
                  <span key={chip} className="max-w-[10rem] truncate rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-normal text-gray-600 dark:text-gray-300">{chip}</span>
                ))}
              </span>
            )}
          </button>
          {/* hidden, not unmounted: a half-typed tag survives closing the section. */}
          <div id={`${p}-more`} hidden={!moreOpen} className="mt-3 space-y-5">
            {loanEligible && !loanInline && loanPicker}

            <div>
                <div id={`${p}-group-payment`} className={FIELD_LABEL}>
                  {t('transactions:form.paymentMethodLabel', 'Payment Method')}
                </div>
                <div role="group" aria-labelledby={`${p}-group-payment`} ref={revealSelected} className={CHIP_ROW}>
                  <button
                    aria-pressed={!formData.paymentMethod}
                    type="button"
                    onClick={() => onChange('paymentMethod', '')}
                    className={cn(CHIP, !formData.paymentMethod ? CHIP_ON : CHIP_OFF)}
                  >
                    {!formData.paymentMethod && <ChipCheck />}
                    {t('transactions:form.paymentNone', 'Not set')}
                  </button>
                  {PAYMENT_METHODS.map((method) => {
                    const isSelected = formData.paymentMethod === method.value;
                    return (
                      <button
                        aria-pressed={isSelected}
                        key={method.value}
                        type="button"
                        onClick={() => onChange('paymentMethod', method.value)}
                        className={cn(CHIP, isSelected ? CHIP_ON : CHIP_OFF)}
                      >
                        {isSelected && <ChipCheck />}
                        {t(`transactions:form.paymentMethods.${method.value}`, method.label)}
                      </button>
                    );
                  })}
                </div>
              </div>

            <TagsField idPrefix={p} tags={formData.tags} onChange={onTagsChange} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The submit row. Below md it sticks to the top of the bottom tab bar
 * (3.5rem + 1px border + safe-area inset, as in MobileBottomNav), so saving
 * never needs a scroll to the end of a long form. It bleeds to the card edge
 * (-mx-4 against the card's p-4) so content scrolls cleanly underneath.
 */
export function StickySubmitBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky z-10 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom,0px))] -mx-4 -mb-4 px-4 py-3 rounded-b-xl border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6 md:static md:m-0 md:p-0 md:pt-2 md:border-0 md:bg-transparent md:backdrop-blur-none">
      {children}
    </div>
  );
}

interface TagsFieldProps {
  idPrefix: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}

/** Tag input: Enter adds a tag, Backspace on an empty input removes the last one. */
export function TagsField({ idPrefix: p, tags, onChange }: TagsFieldProps) {
  const { t } = useTranslation(['transactions']);
  const [tagInput, setTagInput] = useState('');

  const addTag = () => {
    const tag = tagInput.trim().replace(/^#/, '');
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
      setTagInput('');
    }
  };
  const removeTag = (tagToRemove: string) => onChange(tags.filter(tag => tag !== tagToRemove));

  return (
    <div>
      <label htmlFor={`${p}-tags`} className={FIELD_LABEL}>
        {t('transactions:fields.tags', 'Tags')}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">#</span>
          <input
            id={`${p}-tags`}
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
                removeTag(tags[tags.length - 1]);
              }
            }}
            placeholder={t('transactions:form.tagPlaceholder', 'Add a tag (press Enter)')}
            enterKeyHint="enter"
            className={cn(FIELD_INPUT, 'pl-7')}
          />
        </div>
        <button
          type="button"
          onClick={addTag}
          disabled={!tagInput.trim()}
          className={cn('px-4 py-2.5 sm:py-2 min-h-11 lg:min-h-0 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', tagInput.trim() ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed')}
        >{t('transactions:form.addTag', 'Add')}</button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {tags.map((tag) => (
            <div key={tag} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm">
              <span>#{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t('transactions:form.removeTag', { tag, defaultValue: 'Remove tag {{tag}}' })}
                // The padding is the tap area; the negative margin keeps the pill's size.
                className="p-1.5 -m-1.5 rounded-full hover:text-primary-900 dark:hover:text-primary-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
