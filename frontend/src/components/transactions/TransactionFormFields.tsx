'use client';

/**
 * The cash-transaction fields shared by /transactions/add and
 * /transactions/edit/[id]: one copy, so a fix or a translation lands in both.
 * Each page keeps its own investment sub-form, which really does differ.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';

export const TRANSACTION_TYPES: { value: string; label: string; shortLabel?: string; icon: string; color: string }[] = [
  { value: 'expense',    label: 'Expense',    icon: '💸', color: 'red'    },
  { value: 'income',     label: 'Income',     icon: '💰', color: 'green'  },
  { value: 'transfer',   label: 'Transfer',   icon: '🔄', color: 'blue'   },
  { value: 'investment', label: 'Investment', shortLabel: 'Invest', icon: '📈', color: 'purple' },
];

export const CATEGORIES = {
  expense: [
    { value: 'Dining',          label: 'Dining',     icon: '🍽️' },
    { value: 'Groceries',       label: 'Groceries',  icon: '🛒' },
    { value: 'Transportation',  label: 'Transport',  icon: '🚗' },
    { value: 'Shopping',        label: 'Shopping',   icon: '🛍️' },
    { value: 'Entertainment',   label: 'Fun',        icon: '🎬' },
    { value: 'Healthcare',      label: 'Health',     icon: '🏥' },
    { value: 'Housing',         label: 'Housing',    icon: '🏠' },
    { value: 'Utilities',       label: 'Utilities',  icon: '💡' },
    { value: 'Travel',          label: 'Travel',     icon: '✈️' },
    { value: 'Gift',            label: 'Gift',       icon: '🎁' },
    { value: 'Loan Payment',    label: 'Loan',       icon: '💳' },
    { value: 'Others',          label: 'Others',     icon: '📦' },
  ],
  income: [
    { value: 'Salary',             label: 'Salary',     icon: '💼' },
    { value: 'Freelance',          label: 'Freelance',  icon: '💻' },
    { value: 'Investment Returns', label: 'Investment', icon: '📈' },
    { value: 'Gift',               label: 'Gift',       icon: '🎁' },
    { value: 'Others',             label: 'Others',     icon: '💵' },
  ],
};

export const PAYMENT_METHODS = [
  { value: 'cash',           label: 'Cash',          icon: '💵' },
  { value: 'credit_card',    label: 'Credit Card',   icon: '💳' },
  { value: 'bank_transfer',  label: 'Bank Transfer', icon: '🏦' },
  { value: 'digital_wallet', label: 'E-Wallet',      icon: '📱' },
];

// Life and Emergency are the only cash wallets. The Portfolio wallet holds
// invested assets only — never cash — so it is not a valid wallet for income/
// expense entries OR transfers. To move cash into investments you buy a holding
// (which debits the Life Wallet).
const WALLET_TYPES = [
  { value: 'life',      label: 'Life Wallet',      icon: '💳', description: 'Daily income/expenses' },
  { value: 'emergency', label: 'Emergency Wallet', icon: '🚨', description: 'Emergency fund'        },
];

const CURRENCIES = ['TWD', 'USD', 'HKD', 'JPY', 'EUR', 'SGD'];

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
  if (!formData.description.trim()) {
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
const OPTIONAL_HINT = 'text-xs text-gray-500 dark:text-gray-400 font-normal italic';

// One look for every single-select tile, so category, payment and wallet read as
// the same kind of control.
const TILE = 'rounded-xl border-2 transition-colors duration-150 touch-manipulation active:scale-[0.97]';
const TILE_ON = 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/30';
const TILE_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500';

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
}

/**
 * Amount first (it is what the user came to type), then category or the transfer
 * wallets, description + date, and the optional loan / wallet / payment pickers.
 */
export function CashFields({ idPrefix: p, formData, errors, onChange, activeLoans, showInvestmentHint = false, autoFocusAmount = false }: CashFieldsProps) {
  const { t } = useTranslation(['transactions']);
  const categories = formData.type === 'transfer' ? [] : CATEGORIES[formData.type as keyof typeof CATEGORIES] || [];

  return (
    <>
      {/* Amount */}
      <div>
        <label htmlFor={`${p}-amount`} className={FIELD_LABEL}>{t('transactions:fields.amount', 'Amount')}</label>
        <div className={cn(
          'flex items-center gap-2 rounded-xl border-2 px-2 py-1.5 focus-within:border-primary-500 dark:focus-within:border-primary-400',
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
              'flex-1 min-w-0 py-1 text-3xl sm:text-2xl font-bold tabular-nums bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:ring-0',
              errors.amount && 'text-error-700 dark:text-error-500'
            )}
            autoFocus={autoFocusAmount}
          />
        </div>
        {errors.amount && <p id={`${p}-amount-error`} role="alert" className="text-xs text-error-700 dark:text-error-500 mt-1">{errors.amount}</p>}
      </div>

      {/* Category (income / expense) */}
      {formData.type !== 'transfer' && (
        <div>
          <div id={`${p}-group-category`} className={FIELD_LABEL}>
            {t('transactions:form.categoryLabel', 'Category')} {errors.category && <span className="text-error-700 dark:text-error-500 text-xs">*</span>}
          </div>
          <div role="group" aria-labelledby={`${p}-group-category`} className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 sm:gap-2">
            {categories.map((category) => {
              const isSelected = formData.category === category.value;
              return (
                <button
                  aria-pressed={isSelected}
                  key={category.value}
                  type="button"
                  onClick={() => onChange('category', category.value)}
                  className={cn('flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[64px]', TILE, isSelected ? TILE_ON : TILE_OFF)}
                >
                  <span className="text-xl sm:text-2xl leading-none" aria-hidden="true">{category.icon}</span>
                  <span className={cn(
                    'text-[11px] sm:text-xs font-medium text-center leading-tight',
                    isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'
                  )}>{t(`transactions:form.categories.${category.value}`, category.label)}</span>
                </button>
              );
            })}
          </div>
          {errors.category && <p className="text-sm text-error-700 dark:text-error-500 mt-1" role="alert">{errors.category}</p>}
        </div>
      )}

      {/* Transfer wallet selection: From → To side by side */}
      {formData.type === 'transfer' && (
        <div className="space-y-3">
          {showInvestmentHint && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs">
              <span className="text-base">💡</span>
              <span>{t('transactions:form.transferHint.use', 'Use')} <strong>{t('transactions:form.types.transfer', 'Transfer')}</strong> {t('transactions:form.transferHint.mid', 'to move cash between wallets. To buy or sell assets, use the')} <strong>{t('transactions:form.types.investment', 'Investment')}</strong> {t('transactions:form.transferHint.end', 'tab instead.')}</span>
            </div>
          )}
          {(['fromWallet', 'toWallet'] as const).map((side) => {
            const tone = side === 'fromWallet' ? 'expense' : 'income';
            return (
              <div key={side}>
                <div id={`${p}-group-${side}`} className={FIELD_LABEL}>
                  {side === 'fromWallet' ? t('transactions:form.fromWallet', 'From Wallet') : t('transactions:form.toWallet', 'To Wallet')} <span className="text-error-700 dark:text-error-500">*</span>
                </div>
                <div role="group" aria-labelledby={`${p}-group-${side}`} className="grid grid-cols-2 gap-2">
                  {WALLET_TYPES.map((wallet) => {
                    const isSelected = formData[side] === wallet.value;
                    return (
                      <button
                        aria-pressed={isSelected}
                        key={wallet.value}
                        type="button"
                        onClick={() => onChange(side, wallet.value)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2.5',
                          TILE,
                          isSelected
                            ? tone === 'expense'
                              ? 'border-expense-500 bg-expense-50 dark:bg-expense-900/30'
                              : 'border-income-500 bg-income-50 dark:bg-income-900/30'
                            : TILE_OFF
                        )}
                      >
                        <span className="text-lg" aria-hidden="true">{wallet.icon}</span>
                        <span className={cn(
                          'text-sm font-semibold text-left leading-tight',
                          isSelected
                            ? tone === 'expense' ? 'text-expense-700 dark:text-expense-300' : 'text-income-700 dark:text-income-300'
                            : 'text-gray-700 dark:text-gray-300'
                        )}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {errors.transfer && <p role="alert" className="text-sm text-error-700 dark:text-error-500 text-center">{errors.transfer}</p>}
        </div>
      )}

      {/* Description + Date: one row, unless the phone is too narrow to give the description room */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-3">
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
            className={cn(FIELD_INPUT, errors.description && 'border-error-400')}
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
            className={cn(FIELD_INPUT, 'px-2 min-h-[2.75rem] sm:min-h-0')}
          />
        </div>
      </div>

      {/* Loan Link (expense only): linking reduces the loan balance, unlinking restores it */}
      {formData.type === 'expense' && activeLoans.length > 0 && (
        <div>
          <div id={`${p}-group-loan`} className={FIELD_LABEL}>
            {t('transactions:form.linkToLoan', 'Link to Loan')} <span className={OPTIONAL_HINT}>{t('transactions:form.linkToLoanHint', '(optional — reduces loan balance)')}</span>
          </div>
          <div role="group" aria-labelledby={`${p}-group-loan`} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button
              aria-pressed={!formData.loanId}
              type="button"
              onClick={() => onChange('loanId', '')}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 text-sm font-medium',
                TILE,
                !formData.loanId
                  ? 'border-gray-400 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                  : cn(TILE_OFF, 'text-gray-500 dark:text-gray-400')
              )}
            >
              <span aria-hidden="true">🚫</span> {t('transactions:form.loanNone', 'None')}
            </button>
            {activeLoans.map(loan => (
              <button
                aria-pressed={formData.loanId === loan.id}
                key={loan.id}
                type="button"
                onClick={() => onChange('loanId', loan.id)}
                className={cn(
                  'flex flex-col items-start gap-0.5 px-3 py-2 text-sm min-w-0',
                  TILE,
                  formData.loanId === loan.id
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                    : cn(TILE_OFF, 'hover:border-purple-300 dark:hover:border-purple-700')
                )}
              >
                <span className={cn('font-semibold truncate max-w-full', formData.loanId === loan.id ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300')}>
                  💳 {loan.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('transactions:form.loanBalance', 'Balance')}: {formatCurrency(loan.current_balance, loan.currency, { precision: 0 })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Wallet Type (income / expense only) */}
      {formData.type !== 'transfer' && (
        <div>
          <div id={`${p}-group-wallet-type`} className={FIELD_LABEL}>
            {t('transactions:form.walletTypeLabel', 'Wallet Type')} <span className="text-error-700 dark:text-error-500">*</span>
          </div>
          <div role="group" aria-labelledby={`${p}-group-wallet-type`} className="grid grid-cols-2 gap-2 sm:gap-3">
            {WALLET_TYPES.map((wallet) => {
              const isSelected = formData.walletType === wallet.value;
              return (
                <button
                  aria-pressed={isSelected}
                  key={wallet.value}
                  type="button"
                  onClick={() => onChange('walletType', wallet.value)}
                  className={cn('flex flex-col items-start gap-1 px-3 py-2.5 sm:p-4', TILE, isSelected ? TILE_ON : TILE_OFF)}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-lg sm:text-xl" aria-hidden="true">{wallet.icon}</span>
                    <span className={cn('text-sm font-semibold text-left leading-tight', isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.wallets.${wallet.value}`, wallet.label)}</span>
                  </div>
                  {/* The description is a second line of small print a phone has no room for. */}
                  <p className={cn('hidden sm:block text-xs w-full text-left', isSelected ? 'text-primary-700 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400')}>{t(`transactions:form.walletDescriptions.${wallet.value}`, wallet.description)}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Method (income / expense only) */}
      {formData.type !== 'transfer' && (
        <div>
          <div id={`${p}-group-payment`} className={FIELD_LABEL}>
            {t('transactions:form.paymentMethodLabel', 'Payment Method')} <span className={OPTIONAL_HINT}>{t('transactions:form.optional', '(optional)')}</span>
          </div>
          <div role="group" aria-labelledby={`${p}-group-payment`} className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {PAYMENT_METHODS.map((method) => {
              const isSelected = formData.paymentMethod === method.value;
              return (
                <button
                  aria-pressed={isSelected}
                  key={method.value}
                  type="button"
                  onClick={() => onChange('paymentMethod', method.value)}
                  className={cn('flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[64px]', TILE, isSelected ? TILE_ON : TILE_OFF)}
                >
                  <span className="text-xl sm:text-2xl leading-none" aria-hidden="true">{method.icon}</span>
                  <span className={cn('text-[11px] sm:text-xs font-medium text-center leading-tight', isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300')}>{t(`transactions:form.paymentMethods.${method.value}`, method.label)}</span>
                </button>
              );
            })}
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
        {t('transactions:fields.tags', 'Tags')} <span className={OPTIONAL_HINT}>{t('transactions:form.optional', '(optional)')}</span>
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
          className={cn('px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors', tagInput.trim() ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed')}
        >{t('transactions:form.addTag', 'Add')}</button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {tags.map((tag) => (
            <div key={tag} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm">
              <span>#{tag}</span>
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="hover:text-primary-900 dark:hover:text-primary-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="hidden sm:block text-xs text-gray-500 dark:text-gray-400 mt-2">{t('transactions:form.tagsHelp', 'Use tags to organize your transactions (e.g., #vacation, #business)')}</p>
    </div>
  );
}
