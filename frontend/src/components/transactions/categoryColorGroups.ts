/**
 * The colour of each spending group, as the Transactions page pie draws it. Shared so
 * the add/edit form can colour a category chip by the slice it will land in: the
 * pie, its legend and the form name a group with one colour.
 *
 * `border` / `borderOn` outline a category chip, soft and then selected.
 */

import {
  isTransferCategory,
  FOOD_CATEGORIES,
  TRANSPORT_CATEGORIES,
  HOUSING_CATEGORIES,
  INVESTMENT_CATEGORIES,
} from '@/utils/expenseGroups';

export const categoryColorGroups = {
  food: {
    categories: FOOD_CATEGORIES,
    color: '#f59e0b',
    labelKey: 'transactions:filters.group.food',
    icon: '🍔',
    lightBg: 'bg-amber-100 dark:bg-amber-900/30',
    lightText: 'text-amber-700 dark:text-amber-300',
    lightRing: 'ring-amber-300 dark:ring-amber-700',
    hoverBg: 'hover:bg-amber-50/50 dark:hover:bg-amber-900/10',
    border: 'border-amber-300 dark:border-amber-700/70',
    borderOn: 'border-amber-500 dark:border-amber-400',
  },
  transportation: {
    categories: TRANSPORT_CATEGORIES,
    color: '#06b6d4',
    labelKey: 'transactions:filters.group.transport',
    icon: '🚗',
    lightBg: 'bg-cyan-100 dark:bg-cyan-900/30',
    lightText: 'text-cyan-700 dark:text-cyan-300',
    lightRing: 'ring-cyan-300 dark:ring-cyan-700',
    hoverBg: 'hover:bg-cyan-50/50 dark:hover:bg-cyan-900/10',
    border: 'border-cyan-300 dark:border-cyan-700/70',
    borderOn: 'border-cyan-500 dark:border-cyan-400',
  },
  housing: {
    categories: HOUSING_CATEGORIES,
    color: '#3b82f6',
    labelKey: 'transactions:filters.group.housing',
    icon: '🏠',
    lightBg: 'bg-blue-100 dark:bg-blue-900/30',
    lightText: 'text-blue-700 dark:text-blue-300',
    lightRing: 'ring-blue-300 dark:ring-blue-700',
    hoverBg: 'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
    border: 'border-blue-300 dark:border-blue-700/70',
    borderOn: 'border-blue-500 dark:border-blue-400',
  },
  investment: {
    categories: INVESTMENT_CATEGORIES,
    color: '#10b981',
    labelKey: 'transactions:filters.group.investment',
    icon: '📈',
    lightBg: 'bg-prosperity-100 dark:bg-prosperity-900/30',
    lightText: 'text-prosperity-700 dark:text-prosperity-300',
    lightRing: 'ring-prosperity-300 dark:ring-prosperity-700',
    hoverBg: 'hover:bg-prosperity-50/50 dark:hover:bg-prosperity-900/10',
    border: 'border-prosperity-300 dark:border-prosperity-700/70',
    borderOn: 'border-prosperity-500 dark:border-prosperity-400',
  },
  // Its own slice, the way investment purchases already get one. A wallet transfer
  // folded into "Others" reads as spending that never happened: a six-figure
  // emergency-fund top-up sat inside the purple wedge with the shopping.
  transfer: {
    categories: [],
    color: '#64748b',
    labelKey: 'transactions:filters.group.transfer',
    icon: '🔁',
    lightBg: 'bg-slate-100 dark:bg-slate-800/60',
    lightText: 'text-slate-700 dark:text-slate-300',
    lightRing: 'ring-slate-300 dark:ring-slate-600',
    hoverBg: 'hover:bg-slate-50/50 dark:hover:bg-slate-800/40',
    border: 'border-slate-300 dark:border-slate-600',
    borderOn: 'border-slate-500 dark:border-slate-400',
  },
  others: {
    categories: [],
    color: '#8b5cf6',
    labelKey: 'transactions:filters.group.other',
    icon: '🎯',
    lightBg: 'bg-purple-100 dark:bg-purple-900/30',
    lightText: 'text-purple-700 dark:text-purple-300',
    lightRing: 'ring-purple-300 dark:ring-purple-700',
    hoverBg: 'hover:bg-purple-50/50 dark:hover:bg-purple-900/10',
    border: 'border-purple-300 dark:border-purple-700/70',
    borderOn: 'border-purple-500 dark:border-purple-400',
  },
};

export const getCategoryColorGroup = (category: string) => {
  if (categoryColorGroups.food.categories.includes(category)) return categoryColorGroups.food;
  if (categoryColorGroups.transportation.categories.includes(category)) return categoryColorGroups.transportation;
  if (categoryColorGroups.housing.categories.includes(category)) return categoryColorGroups.housing;
  if (categoryColorGroups.investment.categories.includes(category)) return categoryColorGroups.investment;
  // Matched by shape, not by a list: the spelling varies with whoever typed or
  // imported it, and this is the same predicate the spending averages use.
  if (isTransferCategory(category)) return categoryColorGroups.transfer;
  return categoryColorGroups.others;
};
