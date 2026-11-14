'use client';

/**
 * The cash-transaction fields shared by /transactions/add and
 * /transactions/edit/[id]: one copy, so a fix or a translation lands in both.
 * Each page keeps its own investment sub-form, which really does differ.
 *
 * The form speaks two visual languages, no more:
 * - a choice is a segmented control (two to four options) or a row of chips
 *   (more than fit), and either shows "chosen" as a raised or filled shape plus
 *   a check, never by colour alone;
 * - what gets typed sits in the entry panel (ENTRY_PANEL): borderless inputs on
 *   one soft surface, each underlined in the brand colour while it has focus.
 * Settings that are usually left alone (date, wallet, More options) are rows of
 * one hairline list: label above the control on a phone, beside it from sm.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import {
  ArrowDownLeftIcon, ArrowTrendingUpIcon, ArrowUpRightIcon, ArrowsRightLeftIcon,
  CheckIcon, ChevronDownIcon, InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { getCategoryColorGroup } from './categoryColorGroups';

export const TRANSACTION_TYPES: { value: string; label: string; shortLabel?: string }[] = [
  { value: 'expense',    label: 'Expense' },
  { value: 'income',     label: 'Income' },
  { value: 'transfer',   label: 'Transfer' },
  { value: 'investment', label: 'Investment', shortLabel: 'Invest' },
];

/**
 * How each type marks its money: the sign in front of the amount (a shape, so
 * the direction is not carried by colour alone) and the colour of that sign and
 * of the chosen type segment.
 */
export const TYPE_TONE: Record<string, { sign: string; text: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }> = {
  expense:    { sign: '−', text: 'text-expense-700 dark:text-expense-400', icon: ArrowUpRightIcon },
  income:     { sign: '+', text: 'text-income-700 dark:text-income-400',   icon: ArrowDownLeftIcon },
  transfer:   { sign: '',  text: 'text-blue-700 dark:text-blue-400',       icon: ArrowsRightLeftIcon },
  investment: { sign: '−', text: 'text-violet-700 dark:text-violet-400',   icon: ArrowTrendingUpIcon },
};

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

/** Every currency picker on the add and edit forms, in one order. */
export const CURRENCIES = ['TWD', 'USD', 'HKD', 'JPY', 'EUR', 'SGD'];

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
  /** The goal whose reserved cash pays this Life expense ('' or absent: none). */
  goalId?: string;
}

/** A goal an expense can be paid from (holds Life cash, or this row already uses it). */
export interface PayableGoal {
  id: string;
  title: string;
  /** TWD still reserved for the goal. */
  reservedAmount: number;
}

/** The goals a cash form offers under "Pay from goal": those holding cash, plus the row's own. */
export function payableGoals(
  goals: { id: string; title: string; status: string; reservedAmount?: number | string }[],
  currentGoalId?: string,
): PayableGoal[] {
  return goals
    .filter((g) => g.id === currentGoalId || (g.status !== 'cancelled' && (Number(g.reservedAmount) || 0) > 0))
    .map((g) => ({ id: g.id, title: g.title, reservedAmount: Number(g.reservedAmount) || 0 }));
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
// into any focused input under 16px, which on this form meant every tap. 48px
// tall below lg, as docs/UI_CONVENTIONS.md asks of form inputs on touch.
export const FIELD_LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';
export const FIELD_INPUT = 'w-full bg-white dark:bg-gray-900/40 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-3 lg:py-2 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500';

// The entry panel: one soft surface holding what gets typed, its inputs borderless
// and split by hairlines. A field in it shows focus as a brand underline.
export const ENTRY_PANEL = 'rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 divide-y divide-gray-200 dark:divide-gray-700';
export const ENTRY_SECTION = 'px-4 py-3 sm:px-5';
export const ENTRY_CAPTION = 'block text-xs font-medium text-gray-500 dark:text-gray-400';
// An input inside the panel. The 2px bottom border is transparent until focus.
export const ENTRY_INPUT = 'w-full min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none bg-transparent border-0 border-b-2 border-transparent rounded-none px-0 py-2 min-h-12 lg:min-h-10 text-base sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-0 focus-visible:border-primary-500 dark:focus-visible:border-primary-400 transition-colors motion-reduce:transition-none';
export const ENTRY_INPUT_INVALID = 'border-error-500 dark:border-error-400';
export const ERROR_TEXT = 'text-xs text-error-700 dark:text-error-400 mt-1.5';
// A note that explains, not warns.
export const NOTE = 'flex items-start gap-2 rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300';

// A choice with more options than fit is one row of chips. On a phone it swipes,
// bleeding to the card edge (-mx-4 against the card's p-4) with the far end faded
// to show it continues. From sm the chips wrap: a mouse cannot swipe, and the
// scrollbar is hidden. scroll-pl matches px, or snapping pulls the first chip
// under the edge; scroll-pr keeps a focused chip clear of the fade. `relative`
// makes the row the chips' offsetParent, for revealSelected.
export const CHIP_ROW = 'relative flex gap-2 overflow-x-auto scrollbar-hide snap-x scroll-pl-4 scroll-pr-10 py-1 -mx-4 px-4 fade-end after:w-6 after:shrink-0 after:content-[""] sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible sm:fade-none sm:after:hidden';
// min-h-11: 44px on touch screens; a laptop keeps the compact chip.
export const CHIP = 'shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 min-h-11 lg:min-h-0 lg:py-1.5 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
export const CHIP_ON = 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-semibold';
export const CHIP_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500';

// Category is the choice every entry makes, so on a phone it is a grid of tiles
// (icon over label) with every option in sight, not a swiping row that hides most
// of them past the edge. From sm the tiles turn back into the wrapping chips every
// other choice uses. Layered on CHIP: cn's tailwind-merge drops what they replace.
const CATEGORY_GRID = 'grid gap-2 py-1 sm:flex sm:flex-wrap';
const CATEGORY_TILE = 'flex-col justify-center gap-1 min-w-0 rounded-xl px-1 min-h-[4.25rem] text-xs sm:flex-row sm:justify-start sm:gap-1.5 sm:rounded-full sm:px-3.5 sm:min-h-11 sm:text-sm';
// A two-word name may wrap to a second line; a word is never split.
const CATEGORY_LABEL = 'max-w-full text-center leading-tight whitespace-normal line-clamp-2 sm:line-clamp-none sm:truncate sm:whitespace-nowrap';
const CATEGORY_ICON_SLOT = 'flex h-6 w-6 items-center justify-center text-lg leading-none sm:h-auto sm:w-5 sm:text-base';

// A choice of two to four is a segmented control: the chosen segment is raised.
export const SEGMENTED = 'inline-flex rounded-xl bg-gray-100 dark:bg-gray-900/70 p-1 gap-1';
export const SEGMENT = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 lg:py-1.5 min-h-11 lg:min-h-0 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
export const SEGMENT_ON = 'bg-white dark:bg-gray-700 text-primary-700 dark:text-primary-300 shadow-sm ring-1 ring-black/5 dark:ring-white/10 font-semibold';
export const SEGMENT_OFF = 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-gray-800/60';

// The settings list: hairline rows, label above the control on a phone (where the
// control then takes the full width) and beside it from sm.
export const ROW_LIST = 'border-y border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700';
export const ROW = 'flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4';
export const ROW_LABEL = 'text-sm font-medium text-gray-700 dark:text-gray-300';
// A segmented control in a row: full width (equal segments) on a phone.
export const ROW_SEGMENTED = cn(SEGMENTED, 'flex w-full sm:inline-flex sm:w-auto');
export const ROW_SEGMENT = 'flex-1 sm:flex-none';

/** The selected chip's mark: a shape, so "chosen" is not carried by colour alone. */
function ChipCheck() {
  return <CheckIcon className="w-4 h-4 shrink-0" aria-hidden="true" />;
}

/**
 * After a failed submit, scroll the topmost visible error into view and focus its
 * field. Topmost on screen, not first in the markup. Runs a frame later, once
 * React has rendered the messages.
 */
export function revealFirstError(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    const alerts = [...(form?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].filter((a) => a.offsetParent !== null);
    if (!form || alerts.length === 0) return;
    const first = alerts.reduce((a, b) => (b.getBoundingClientRect().top < a.getBoundingClientRect().top ? b : a));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    first.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    // The field the message describes, or (for a chip group) its chosen chip, else
    // the first: a chip further along the row would scroll the row back.
    const owner = first.id ? form.querySelector<HTMLElement>(`[aria-describedby~="${first.id}"]`) : null;
    const target = owner?.matches('input, select, textarea, button')
      ? owner
      : owner?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? owner?.querySelector<HTMLElement>('button');
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

interface TypeToggleProps {
  idPrefix: string;
  /** The types this form offers, in TRANSACTION_TYPES order. */
  types: string[];
  value: string;
  onPick: (type: string) => void;
}

/**
 * The transaction type, one segmented control on both pages. The chosen segment
 * is raised and takes its type's colour; from sm it also carries the type's
 * direction arrow.
 */
export function TypeToggle({ idPrefix: p, types, value, onPick }: TypeToggleProps) {
  const { t } = useTranslation(['transactions']);
  return (
    <div>
      {/* Named for screen readers only: the buttons say what they are. */}
      <div id={`${p}-group-type`} className="sr-only">{t('transactions:form.typeLabel', 'Transaction Type')}</div>
      <div role="group" aria-labelledby={`${p}-group-type`} className={cn(SEGMENTED, 'flex w-full')}>
        {TRANSACTION_TYPES.filter((type) => types.includes(type.value)).map((type) => {
          const on = value === type.value;
          const Icon = TYPE_TONE[type.value].icon;
          return (
            <button
              aria-pressed={on}
              key={type.value}
              type="button"
              onClick={() => onPick(type.value)}
              className={cn(SEGMENT, 'flex-1 min-w-0 px-1.5 max-[359px]:px-1 max-[359px]:text-xs sm:px-3', on ? cn(SEGMENT_ON, TYPE_TONE[type.value].text) : SEGMENT_OFF)}
            >
              <Icon className="hidden sm:block w-4 h-4 shrink-0" aria-hidden="true" />
              {/* A phone has ~80px per segment: too narrow for "Investment". */}
              {type.shortLabel && (
                <span className="truncate sm:hidden">{t(`transactions:form.typesShort.${type.value}`, type.shortLabel)}</span>
              )}
              <span className={cn('truncate', type.shortLabel && 'max-sm:hidden')}>{t(`transactions:form.types.${type.value}`, type.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CashFieldsProps {
  /** Prefix for element ids, so labels stay unique per page. */
  idPrefix: string;
  formData: CashFormData;
  errors: Record<string, string>;
  onChange: (field: keyof CashFormData, value: string) => void;
  activeLoans: ActiveLoan[];
  /** Goals this expense can be paid from (see payableGoals). */
  goals?: PayableGoal[];
  /** The transfer hint points at the Investment tab, which only the add form has. */
  showInvestmentHint?: boolean;
  /** Focus the amount on mount. For a new entry only: on edit it would open the
   *  phone keyboard over a form the user may only want to re-categorise. */
  autoFocusAmount?: boolean;
  onTagsChange: (tags: string[]) => void;
}

/**
 * The entry panel (amount, description) first, then the category, then the
 * settings list: date, wallet, and More options (loan link, payment method, tags).
 */
export function CashFields({ idPrefix: p, formData, errors, onChange, onTagsChange, activeLoans, goals: goalOptions = [], showInvestmentHint = false, autoFocusAmount = false }: CashFieldsProps) {
  const { t } = useTranslation(['transactions', 'goals']);
  const categories = formData.type === 'transfer' ? [] : CATEGORIES[formData.type as keyof typeof CATEGORIES] || [];
  const tone = TYPE_TONE[formData.type] ?? TYPE_TONE.expense;

  // A loan is paid down by the link, not the category, so a mortgage filed under
  // Housing can still be linked. The picker sits inline for a Loan Payment
  // expense, and in More options for any other expense.
  const loanEligible = formData.type === 'expense' && activeLoans.length > 0;
  const loanInline = loanEligible && formData.category === LOAN_CATEGORY;
  const linkedLoan = activeLoans.find((loan) => loan.id === formData.loanId);

  // Paying from a goal spends cash reserved for it, so Life's free cash does
  // not drop a second time. Only a Life expense can, and only a goal that holds
  // cash (or the one this row already pays from, on edit).
  const goalEligible = formData.type === 'expense' && formData.walletType === 'life' && goalOptions.length > 0;
  const linkedGoal = goalOptions.find((g) => g.id === formData.goalId);
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
      || !!formData.goalId
  );
  const moreSummary = [
    ...(payment ? [t(`transactions:form.paymentMethods.${payment.value}`, payment.label)] : []),
    ...(linkedLoan && !loanInline ? [linkedLoan.name] : []),
    ...(linkedGoal && goalEligible ? [`🎯 ${linkedGoal.title}`] : []),
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

  const goalPicker = (
    <div>
      <div id={`${p}-group-goal`} className={FIELD_LABEL}>
        {t('goals:reserve.payFromGoal', 'Pay from goal')}
      </div>
      <div role="group" aria-labelledby={`${p}-group-goal`} ref={revealSelected} className={CHIP_ROW}>
        <button
          aria-pressed={!formData.goalId}
          type="button"
          onClick={() => onChange('goalId', '')}
          className={cn(CHIP, !formData.goalId ? CHIP_ON : CHIP_OFF)}
        >
          {!formData.goalId && <ChipCheck />}
          {t('goals:reserve.payFromGoalNone', 'Not from a goal')}
        </button>
        {goalOptions.map((goal) => (
          <button
            aria-pressed={formData.goalId === goal.id}
            key={goal.id}
            type="button"
            onClick={() => onChange('goalId', goal.id)}
            className={cn(CHIP, formData.goalId === goal.id ? CHIP_ON : CHIP_OFF)}
          >
            {formData.goalId === goal.id && <ChipCheck />}
            {goal.title}
            <span className="font-normal opacity-70">{formatCurrency(goal.reservedAmount, 'TWD', { precision: 0 })}</span>
          </button>
        ))}
      </div>
      {linkedGoal && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {t('goals:reserve.payFromGoalHint', {
            amount: formatCurrency(linkedGoal.reservedAmount, 'TWD', { precision: 0 }),
          })}
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* The entry: amount, then what it was for. One surface, read as one line
          of a ledger. The DOM order is the visual order, so Tab and the phone
          keyboard's "next" go amount -> description. */}
      <div>
        <div className={cn(ENTRY_PANEL, (errors.amount || errors.description) && 'border-error-300 dark:border-error-700')}>
          <div className={cn(ENTRY_SECTION, 'pt-3.5 sm:pt-4')}>
            <label htmlFor={`${p}-amount`} className={ENTRY_CAPTION}>{t('transactions:fields.amount', 'Amount')}</label>
            <div className="mt-1 flex items-center gap-2 sm:gap-3">
              <select
                value={formData.currency}
                onChange={(e) => onChange('currency', e.target.value)}
                className="shrink-0 min-h-11 lg:min-h-0 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-2.5 pr-7 py-1.5 text-base sm:text-sm font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                aria-label={t('transactions:form.currency', 'Currency')}
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {/* The direction as a sign, not only as a colour. */}
              {tone.sign && (
                <span aria-hidden="true" className={cn('shrink-0 text-3xl sm:text-4xl font-semibold leading-none', tone.text)}>{tone.sign}</span>
              )}
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
                  ENTRY_INPUT,
                  'min-h-14 py-1 text-4xl sm:text-4xl font-bold tracking-tight tabular-nums placeholder-gray-300 dark:placeholder-gray-600',
                  errors.amount && cn(ENTRY_INPUT_INVALID, 'text-error-700 dark:text-error-400')
                )}
                autoFocus={autoFocusAmount}
              />
            </div>
          </div>
          <div className={cn(ENTRY_SECTION, 'pt-2.5 pb-1.5')}>
            <label htmlFor={`${p}-description`} className={ENTRY_CAPTION}>
              {t('transactions:fields.description', 'Description')}
              {formData.type === 'transfer' && <span className="font-normal"> {t('transactions:form.optional', '(optional)')}</span>}
            </label>
            <input
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? `${p}-description-error` : undefined}
              id={`${p}-description`}
              type="text"
              value={formData.description}
              onChange={(e) => onChange('description', e.target.value)}
              placeholder={t('transactions:form.descriptionPlaceholder', "What's this for?")}
              enterKeyHint="done"
              className={cn(ENTRY_INPUT, 'text-base', errors.description && ENTRY_INPUT_INVALID)}
            />
          </div>
        </div>
        {errors.amount && <p id={`${p}-amount-error`} role="alert" className={ERROR_TEXT}>{errors.amount}</p>}
        {errors.description && <p id={`${p}-description-error`} role="alert" className={ERROR_TEXT}>{errors.description}</p>}
      </div>

      {/* Category (income / expense). Unchosen chips are neutral; the chosen one
          takes the colour of the pie slice it lands in, and a check. */}
      {formData.type !== 'transfer' && (
        <div>
          <div id={`${p}-group-category`} className={FIELD_LABEL}>
            {t('transactions:form.categoryLabel', 'Category')} {errors.category && <span className="text-error-700 dark:text-error-400 text-xs">*</span>}
          </div>
          <div
            role="group"
            aria-labelledby={`${p}-group-category`}
            aria-describedby={errors.category ? `${p}-category-error` : undefined}
            className={cn(CATEGORY_GRID, categories.length <= 6 ? 'grid-cols-3' : 'grid-cols-3 min-[360px]:grid-cols-4')}
          >
            {/* Not a button: there is nothing to toggle, it only shows what the row
                holds. Picking a listed chip replaces it. */}
            {unknownCategory && (
              <span
                data-current-category
                className={cn(CHIP, CATEGORY_TILE, 'font-semibold', getCategoryColorGroup(unknownCategory).lightBg, getCategoryColorGroup(unknownCategory).lightText, getCategoryColorGroup(unknownCategory).borderOn)}
              >
                <span className={CATEGORY_ICON_SLOT}><ChipCheck /></span>
                <span className="sr-only">{t('transactions:form.currentCategory', 'Current category:')} </span>
                <span className={CATEGORY_LABEL}>{t(`transactions:form.categories.${unknownCategory}`, unknownCategory)}</span>
              </span>
            )}
            {categories.map((category) => {
              const isSelected = formData.category === category.value;
              const group = getCategoryColorGroup(category.value);
              return (
                <button
                  aria-pressed={isSelected}
                  key={category.value}
                  type="button"
                  onClick={() => pickCategory(category.value)}
                  className={cn(
                    CHIP,
                    CATEGORY_TILE,
                    isSelected
                      ? cn('font-semibold', group.lightBg, group.lightText, group.borderOn)
                      : cn(CHIP_OFF, errors.category && 'border-error-200 dark:border-error-800')
                  )}
                >
                  {/* A fixed slot: emoji glyphs render wider than their box and crowd the label. */}
                  {isSelected
                    ? <span className={CATEGORY_ICON_SLOT}><ChipCheck /></span>
                    : <span aria-hidden="true" className={CATEGORY_ICON_SLOT}>{category.icon}</span>}
                  <span className={CATEGORY_LABEL}>{t(`transactions:form.categories.${category.value}`, category.label)}</span>
                </button>
              );
            })}
          </div>
          {errors.category && <p id={`${p}-category-error`} className={ERROR_TEXT} role="alert">{errors.category}</p>}
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

      {/* Loan picker inline only where it is the point: a Loan Payment expense. */}
      {loanInline && loanPicker}

      {formData.type === 'transfer' && showInvestmentHint && (
        <p className={NOTE}>
          <InformationCircleIcon className="w-5 h-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
          <span>{t('transactions:form.transferHint.use', 'Use')} <strong>{t('transactions:form.types.transfer', 'Transfer')}</strong> {t('transactions:form.transferHint.mid', 'to move cash between wallets. To buy or sell assets, use the')} <strong>{t('transactions:form.types.investment', 'Investment')}</strong> {t('transactions:form.transferHint.end', 'tab instead.')}</span>
        </p>
      )}

      {/* The settings list. */}
      <div>
        <div className={ROW_LIST}>
          {/* Transfer: From, then To. Money leaves From (red, "−") and reaches To (green, "+"). */}
          {formData.type === 'transfer' && (['fromWallet', 'toWallet'] as const).map((side) => (
            <div key={side} className={ROW}>
              <span id={`${p}-group-${side}`} className={ROW_LABEL}>
                {side === 'fromWallet' ? t('transactions:form.fromWallet', 'From Wallet') : t('transactions:form.toWallet', 'To Wallet')}
              </span>
              <div
                role="group"
                aria-labelledby={`${p}-group-${side}`}
                aria-describedby={errors.transfer ? `${p}-transfer-error` : undefined}
                className={ROW_SEGMENTED}
              >
                {WALLET_TYPES.map((wallet) => {
                  const isSelected = formData[side] === wallet.value;
                  return (
                    <button
                      aria-pressed={isSelected}
                      key={wallet.value}
                      type="button"
                      onClick={() => pickTransferWallet(side, wallet.value)}
                      className={cn(
                        SEGMENT, ROW_SEGMENT,
                        isSelected
                          ? cn(SEGMENT_ON, side === 'fromWallet' ? 'text-expense-700 dark:text-expense-300' : 'text-income-700 dark:text-income-300')
                          : SEGMENT_OFF
                      )}
                    >
                      {isSelected && <span aria-hidden="true">{side === 'fromWallet' ? '−' : '+'}</span>}
                      {t(`transactions:form.wallets.${wallet.value}`, wallet.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <DateRow id={`${p}-date`} value={formData.date} onChange={(day) => onChange('date', day)} />

          {/* Wallet: Life for almost every entry. */}
          {formData.type !== 'transfer' && (
            <div className={ROW}>
              <span id={`${p}-group-wallet-type`} className={ROW_LABEL}>
                {t('transactions:form.walletTypeLabel', 'Wallet Type')}
              </span>
              <div role="group" aria-labelledby={`${p}-group-wallet-type`} className={ROW_SEGMENTED}>
                {WALLET_TYPES.map((wallet) => {
                  const isSelected = formData.walletType === wallet.value;
                  return (
                    <button
                      aria-pressed={isSelected}
                      key={wallet.value}
                      type="button"
                      onClick={() => onChange('walletType', wallet.value)}
                      className={cn(SEGMENT, ROW_SEGMENT, isSelected ? SEGMENT_ON : SEGMENT_OFF)}
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
                className="flex w-full min-w-0 min-h-12 items-center gap-2 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-md"
              >
                <span className="shrink-0">{t('transactions:form.moreOptions', 'More options')}</span>
                {!moreOpen && moreSummary.length > 0 && (
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {moreSummary.map((chip) => (
                      <span key={chip} className="max-w-[10rem] truncate rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-normal text-gray-600 dark:text-gray-300">{chip}</span>
                    ))}
                  </span>
                )}
                <ChevronDownIcon className={cn('ml-auto w-4 h-4 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {/* hidden, not unmounted: a half-typed tag survives closing the section. */}
              <div id={`${p}-more`} hidden={!moreOpen} className="pt-1 pb-4 space-y-5">
                {loanEligible && !loanInline && loanPicker}
                {goalEligible && goalPicker}

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
        </div>
        {errors.transfer && <p id={`${p}-transfer-error`} role="alert" className={ERROR_TEXT}>{errors.transfer}</p>}
      </div>
    </>
  );
}

/** "YYYY-MM-DD" for the day `offset` days from today, in local time. */
function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateString(d);
}

interface DateRowProps {
  id: string;
  value: string;
  onChange: (day: string) => void;
  /** Shown, not changed: the shortcuts go and the input is read-only. */
  readOnly?: boolean;
}

/**
 * The date as a row of the settings list. Today / Yesterday sit beside the
 * picker: most entries are one or the other, and the native picker is a round
 * trip for either. Local days, never toISOString(), which is the previous day in
 * Taipei until 08:00.
 */
export function DateRow({ id, value, onChange, readOnly = false }: DateRowProps) {
  const { t } = useTranslation(['transactions']);
  const days = [
    { offset: 0, label: t('transactions:form.today', 'Today') },
    { offset: -1, label: t('transactions:form.yesterday', 'Yesterday') },
  ];
  return (
    <div className={ROW}>
      <label htmlFor={id} className={ROW_LABEL}>{t('transactions:fields.date', 'Date')}</label>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
        {!readOnly && (
          <div className={cn(SEGMENTED, 'flex flex-1 sm:flex-none')}>
            {days.map(({ offset, label }) => {
              const day = dayFromToday(offset);
              const on = value === day;
              return (
                <button
                  key={offset}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(day)}
                  className={cn(SEGMENT, 'flex-1 sm:flex-none px-2.5', on ? SEGMENT_ON : SEGMENT_OFF)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <input
          id={id}
          type="date"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={cn(FIELD_INPUT, 'min-w-[9.5rem] flex-1 sm:flex-none sm:w-[9.5rem] shrink-0 px-2.5 min-h-12 lg:min-h-0 lg:h-10 py-0 read-only:bg-gray-100 dark:read-only:bg-gray-800/60')}
        />
      </div>
    </div>
  );
}

/**
 * The submit row. Below md it is pinned to the top of the bottom tab bar
 * (3.5rem + 1px border + safe-area inset, as in MobileBottomNav), so saving
 * never needs a scroll to the end of a long form.
 *
 * Fixed to the viewport, not sticky: a sticky box is held inside its scroll
 * container's padding, and <main> pads 5.5rem for the tab bar, so a sticky bar
 * floated a tab-bar's height above it with fields showing underneath (and with
 * the demo banner above the layout, sank under it instead). A spacer stands in
 * for the bar's height, so the end of the form can still scroll clear of it.
 */
export function StickySubmitBar({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="h-12 md:hidden" />
      <div className="fixed inset-x-0 z-30 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom,0px))] px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur sm:px-6 md:static md:z-auto md:p-0 md:pt-1 md:border-0 md:bg-transparent md:backdrop-blur-none">
        {children}
      </div>
    </>
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
          className={cn('px-4 py-2.5 sm:py-2 min-h-11 lg:min-h-0 rounded-lg border text-sm font-medium transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', tagInput.trim() ? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed')}
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
                className="p-1.5 -m-1.5 rounded-full hover:text-primary-900 dark:hover:text-primary-100 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
