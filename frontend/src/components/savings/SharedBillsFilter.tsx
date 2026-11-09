'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownTrayIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { SplitOut, SplitStatus } from '@/shared/types';
import { CSV_HEADER, EMPTY_FILTER, NO_CATEGORY, filterOptions, isFiltered, monthLabel as formatMonth, splitsCsv, type SplitFilter } from './sharedSpendingStats';

const STATUSES: SplitStatus[] = ['proposed', 'active', 'declined', 'voided'];
const FIELD = 'min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white px-2';

interface SharedBillsFilterProps {
  /** Every bill the list can show, before filtering. */
  splits: SplitOut[];
  /** The bills left after filtering: what the export writes. */
  shown: SplitOut[];
  filter: SplitFilter;
  onChange: (next: SplitFilter) => void;
}

/** Filter the Shared bills list and export what it shows as CSV. */
export default function SharedBillsFilter({ splits, shown, filter, onChange }: SharedBillsFilterProps) {
  const { t, i18n } = useTranslation(['common', 'transactions']);
  const options = useMemo(() => filterOptions(splits, filter), [splits, filter]);
  const set = (patch: Partial<SplitFilter>) => onChange({ ...filter, ...patch });

  const monthLabel = (m: string) => formatMonth(m, i18n?.language || 'en');
  const categoryLabel = (name: string) => t(`transactions:form.categories.${name}`, name);

  const exportCsv = () => {
    const header = CSV_HEADER.map((h) => t(`savings.splits.export.columns.${h.replace(/ /g, '')}`, h));
    const csv = splitsCsv(shown, header, {
      me: t('savings.splits.export.me', 'Me'), partner: t('savings.splits.export.partner', 'Partner'),
      status: (s) => t(`savings.splits.status.${s}`, s), category: categoryLabel,
    });
    // The BOM lets Excel read the file as UTF-8, so Chinese descriptions survive.
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `shared-bills${filter.month ? `-${filter.month}` : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[10rem]">
          <span className="sr-only">{t('savings.splits.filter.search', 'Search shared bills')}</span>
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input type="search" value={filter.query} onChange={(e) => set({ query: e.target.value })}
            placeholder={t('savings.splits.filter.searchPlaceholder', 'Search bills or partners')}
            className={`${FIELD} w-full pl-8`} />
        </label>
        <select value={filter.month} onChange={(e) => set({ month: e.target.value })} className={FIELD}
          aria-label={t('savings.splits.filter.month', 'Month')}>
          <option value="">{t('savings.splits.filter.anyMonth', 'Any month')}</option>
          {options.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={filter.category} onChange={(e) => set({ category: e.target.value })} className={FIELD}
          aria-label={t('savings.splits.category', 'Category')}>
          <option value="">{t('savings.splits.filter.anyCategory', 'Any category')}</option>
          {options.categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          {options.uncategorised && <option value={NO_CATEGORY}>{t('savings.splits.insights.uncategorised', 'No category')}</option>}
        </select>
        <select value={filter.status} onChange={(e) => set({ status: e.target.value as SplitStatus | '' })} className={FIELD}
          aria-label={t('savings.splits.filter.status', 'Status')}>
          <option value="">{t('savings.splits.filter.anyStatus', 'Any status')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`savings.splits.status.${s}`, s)}</option>)}
        </select>
        <select value={filter.payer} onChange={(e) => set({ payer: e.target.value as SplitFilter['payer'] })} className={FIELD}
          aria-label={t('savings.splits.filter.paidBy', 'Paid by')}>
          <option value="">{t('savings.splits.filter.anyPayer', 'Anyone paid')}</option>
          <option value="me">{t('savings.splits.filter.iPaid', 'I paid')}</option>
          <option value="partner">{t('savings.splits.filter.partnerPaid', 'Partner paid')}</option>
        </select>
        <button type="button" onClick={exportCsv} disabled={shown.length === 0}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <ArrowDownTrayIcon className="w-4 h-4" aria-hidden="true" />
          {t('savings.splits.export.button', 'Export CSV')}
        </button>
      </div>
      {isFiltered(filter) && (
        <p className="text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
          {t('savings.splits.filter.showing', 'Showing {{shown}} of {{total}}', { shown: shown.length, total: splits.length })}
          <button type="button" onClick={() => onChange(EMPTY_FILTER)}
            className="ml-2 underline text-primary-700 dark:text-primary-400 min-h-[24px]">
            {t('savings.splits.filter.clear', 'Clear filters')}
          </button>
        </p>
      )}
    </div>
  );
}
