'use client';

import { Fragment, memo } from 'react';
import Link from 'next/link';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  PencilIcon,
  TrashIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from '@headlessui/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { useEditHref } from '@/lib/transactions/returnTo';
import { formatCurrency } from '@/utils/formatters';
import { highlight } from '@/utils/highlight';
import { getCategoryIcon } from '@/utils/categoryIcon';
import { Transaction } from '@/shared/types';
import { getPaymentMethodColor, getWalletTypeBadge } from './transactionRowStyles';

interface TransactionRowProps {
  transaction: Transaction;
  /** Position within its day group, for the stagger animation only. */
  index: number;
  isSelected: boolean;
  isValueVisible: boolean;
  /** A delete is in flight, so every row's delete action is disabled. */
  isDeleting: boolean;
  searchQuery?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * One transaction.
 *
 * Split out of `TransactionList` and memoised because it was inline JSX inside
 * the map: with no component boundary there was nothing React could skip, so a
 * keystroke in the search box, ticking one checkbox or expanding one day
 * re-rendered every row of every group — each with its own icons, badges and
 * Headless UI menu. There is no React Compiler in this project to do it
 * automatically (see next.config.js), so the boundary has to be drawn by hand.
 *
 * The props are deliberately all primitives or stable callbacks. Passing
 * `selectedTransactions` and letting the row call `.includes` would defeat the
 * memo on every selection change — and cost O(n) per row on top.
 */
function TransactionRowBase({
  transaction,
  index,
  isSelected,
  isValueVisible,
  isDeleting,
  searchQuery,
  onSelect,
  onDelete,
}: TransactionRowProps) {
  const { t } = useTranslation(['transactions']);
  // Edit links carry the list view they were opened from, so saving comes back to it.
  const editHref = useEditHref();
  const wallet = getWalletTypeBadge(transaction.walletType);

  return (
    <div
      key={transaction.id}
      className="border border-gray-200 dark:border-gray-700 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 rounded-lg"
      style={{
        animationDelay: `${index * 30}ms`
      }}
    >
      <div className="group touch-manipulation p-2 sm:p-2.5">
        {/* Top Row: Checkbox, Icon, Description, Amount, Actions */}
        <div className="flex items-start gap-2 sm:gap-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(transaction.id)}
            className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500 border-gray-300 rounded touch-manipulation flex-shrink-0"
            aria-label={`Select transaction ${transaction.description}`}
          />

          <div className="text-2xl flex-shrink-0">
            {getCategoryIcon(transaction.category)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate mb-0.5">
                  {searchQuery ? highlight(transaction.description, searchQuery) : transaction.description}
                </p>
                <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400 min-w-0">
                  <span className="flex-shrink-0">{searchQuery ? highlight(transaction.category, searchQuery) : transaction.category}</span>
                  {/* Wallet Type Badge - Always visible */}
                  <>
                    <span className="flex-shrink-0">•</span>
                    <span className={cn(
                      "flex-shrink-0 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap flex items-center gap-1",
                      wallet.color
                    )}>
                      <span>{wallet.icon}</span>
                      <span>{wallet.label}</span>
                    </span>
                  </>
                  {/* Payment method — visible on all sizes */}
                  {transaction.paymentMethod && (
                    <>
                      <span className="flex-shrink-0">•</span>
                      <span className={cn(
                        "flex-shrink-0 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap",
                        getPaymentMethodColor(transaction.paymentMethod)
                      )}>
                        {transaction.paymentMethod}
                      </span>
                    </>
                  )}
                  {/* Tags — hidden on mobile to keep row compact */}
                  {transaction.tags && transaction.tags.length > 0 && (
                    <div className="hidden sm:flex items-center gap-1 min-w-0 overflow-hidden">
                      <span className="flex-shrink-0">•</span>
                      {transaction.tags.map((tag, index) => (
                        <span
                          key={`${tag}-${index}`}
                          className="flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <div className="text-right">
                  <div
                    className={cn(
                      'text-sm font-semibold whitespace-nowrap',
                      transaction.type === 'income'
                        ? 'text-success-700 dark:text-success-400'
                        : transaction.type === 'transfer'
                        ? 'text-gray-600 dark:text-gray-400'
                        : 'text-error-700 dark:text-error-400'
                    )}
                  >
                    {isValueVisible
                      ? `${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount, transaction.currency, { precision: 0 })}`
                      : '•••••'}

                  </div>
                </div>

                <div className="flex items-center">
                  {transaction.type === 'income' ? (
                    <ArrowTrendingUpIcon className="hidden sm:block w-4 h-4 text-success-700 dark:text-success-500" />
                  ) : (
                    <ArrowTrendingDownIcon className="hidden sm:block w-4 h-4 text-gray-500 dark:text-gray-400" />
                  )}

                  <Menu as="div" className="relative">
                    <MenuButton
                      className="p-1 sm:p-1.5 text-gray-600 hover:text-gray-700 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`Actions for ${transaction.description}`}
                    >
                      <EllipsisVerticalIcon className="w-4 h-4" />
                    </MenuButton>

                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-100"
                      enterFrom="transform opacity-0 scale-95"
                      enterTo="transform opacity-100 scale-100"
                      leave="transition ease-in duration-75"
                      leaveFrom="transform opacity-100 scale-100"
                      leaveTo="transform opacity-0 scale-95"
                    >
                      <MenuItems className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 dark:ring-gray-700 focus:outline-none z-10">
                        <div className="py-1">
                          <MenuItem>
                            {({ active }) => (
                              <Link
                                href={editHref(transaction.id)}
                                className={cn(
                                  'flex items-center w-full px-4 py-2 text-sm',
                                  active ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                                )}
                              >
                                <PencilIcon className="w-4 h-4 mr-3" />
                                {t('transactions:list.edit')}
                              </Link>
                            )}
                          </MenuItem>
                          {/* A holding's cash side goes with the holding (the API refuses it alone). */}
                          {!transaction.holdingId && (
                          <MenuItem>
                            {({ active }) => (
                              <button
                                onClick={() => onDelete(transaction.id)}
                                disabled={isDeleting}
                                className={cn(
                                  'flex items-center w-full px-4 py-2 text-sm',
                                  active ? 'bg-gray-100 dark:bg-gray-700 text-error-900 dark:text-error-400' : 'text-error-700 dark:text-error-400',
                                  isDeleting && 'opacity-50 cursor-not-allowed'
                                )}
                              >
                                <TrashIcon className="w-4 h-4 mr-3" />
                                {isDeleting
                                  ? t('transactions:list.deleting')
                                  : t('transactions:list.delete')}
                              </button>
                            )}
                          </MenuItem>
                          )}
                        </div>
                      </MenuItems>
                    </Transition>
                  </Menu>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TransactionRow = memo(TransactionRowBase);
TransactionRow.displayName = 'TransactionRow';
