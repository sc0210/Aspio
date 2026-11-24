'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { PlusIcon } from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DemoNotice } from '@/components/ui/DemoNotice';
import { QueryErrorCard } from '@/components/ui/QueryErrorCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CATEGORIES, SUBCATEGORIES } from '@/components/transactions/TransactionFormFields';
import { useAppMode } from '@/hooks/useAppMode';
import { useBillActions, useBillSuggestions, useBills, useDueBills } from '@/hooks/useRecurringBills';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { ApiError } from '@/lib/api-client';
import { categoryLabel, subcategoryLabel } from '@/lib/transactions/categoryLabel';
import { transactionService } from '@/services/transactionService';
import type { Bill, BillFrequency, BillSuggestion } from '@/services/recurringService';
import { getCategoryIcon } from '@/utils/categoryIcon';
import { cn } from '@/utils/cn';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { nextAfter, parseDay } from '@/lib/transactions/billDates';

const DISMISSED_KEY = 'aspiro.bills.dismissedSuggestions';

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeDismissed(list: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
  } catch {
    // Private window or blocked storage: the suggestion just comes back next visit.
  }
}

const FIELD = 'w-full h-11 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const LABEL = 'block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1';

export default function BillsPage() {
  const { t } = useTranslation(['transactions', 'common']);
  const { isDemo } = useAppMode();
  const due = useDueBills();
  const bills = useBills();
  const suggestions = useBillSuggestions();
  const [adding, setAdding] = useState<Partial<BillDraft> | null>(null);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [stopping, setStopping] = useState<Bill | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readDismissed()));
  const actions = useBillActions();

  const today = localDateString();
  const dueNow = (due.data ?? []).filter((b) => b.nextOccurrence <= today);
  const comingUp = (due.data ?? []).filter((b) => b.nextOccurrence > today);
  const visibleSuggestions = (suggestions.data ?? []).filter((s) => !dismissed.includes(s.description.toLowerCase()));

  const dismiss = (s: BillSuggestion) => {
    const next = [...dismissed, s.description.toLowerCase()];
    setDismissed(next);
    writeDismissed(next);
  };

  const stop = async () => {
    if (!stopping) return;
    try {
      await actions.update.mutateAsync({ id: stopping.id, changes: { isActive: false } });
      toast.success(t('transactions:bills.stopped', 'Bill removed. What it recorded stays.'));
    } catch {
      toast.error(t('transactions:bills.saveFailed', 'Could not save. Try again.'));
    } finally {
      setStopping(null);
    }
  };

  const addButton = (className?: string) => (
    <Button size="sm" variant="primary" className={cn('gap-1.5', className)} onClick={() => setAdding({})}>
      <PlusIcon className="w-4 h-4" aria-hidden="true" />
      {t('transactions:bills.add', 'Add a bill')}
    </Button>
  );

  return (
    // The header card is phone-only; on a laptop the top bar carries the action.
    <DashboardLayout topBarActions={!isDemo ? addButton() : undefined}>
      <div className="max-w-2xl mx-auto space-y-5 pb-8">
        <PageHeader
          title={t('transactions:bills.title', 'Bills')}
          subtitle={t('transactions:bills.subtitle', 'Bills that come round every month. Record each one when it is due, with what it actually cost.')}
          backHref="/transactions"
          backLabel={t('transactions:monthlySummaryPage.back', 'Back')}
          actions={!isDemo && addButton()}
        />

        {isDemo ? (
          <DemoNotice>{t('transactions:bills.demo', 'Sign in to keep reminders for your bills.')}</DemoNotice>
        ) : (
          <>
            {due.error && !due.data ? (
              <QueryErrorCard onRetry={() => due.refetch()} />
            ) : due.isLoading ? (
              <div className="flex justify-center py-10"><LoadingSpinner /></div>
            ) : (
              <>
                <Section title={t('transactions:bills.dueNow', 'Due now')} count={dueNow.length}>
                  {dueNow.length === 0 ? (
                    <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                      {t('transactions:bills.nothingDue', 'Nothing due. Bills you add show up here on their day.')}
                    </p>
                  ) : dueNow.map((b) => <DueRow key={`${b.id}-${b.nextOccurrence}`} bill={b} today={today} />)}
                </Section>
                {comingUp.length > 0 && (
                  <Section title={t('transactions:bills.comingUp', 'Later this month')} count={comingUp.length}>
                    {comingUp.map((b) => <DueRow key={`${b.id}-${b.nextOccurrence}`} bill={b} today={today} />)}
                  </Section>
                )}
              </>
            )}

            {visibleSuggestions.length > 0 && (
              <Section
                title={t('transactions:bills.suggested', 'Looks like a monthly bill')}
                hint={t('transactions:bills.suggestedHint', 'From your own entries: the same expense about once a month.')}
              >
                {visibleSuggestions.map((s) => (
                  <SuggestionRow
                    key={s.description}
                    suggestion={s}
                    onAccept={() => setAdding({
                      description: s.description, amount: String(s.amount), currency: s.currency,
                      category: s.category, subcategory: s.subcategory ?? '', paymentMethod: s.paymentMethod,
                      frequency: 'monthly', startDate: nextAfter(s.lastDate, s.dayOfMonth),
                    })}
                    onDismiss={() => dismiss(s)}
                  />
                ))}
              </Section>
            )}

            {(bills.data ?? []).length > 0 && (
              <Section title={t('transactions:bills.all', 'Your bills')} count={bills.data!.length}>
                {bills.data!.map((b) => (
                  <BillRow
                    key={b.id}
                    bill={b}
                    onEdit={() => setEditing(b)}
                    onTogglePause={() => actions.update.mutate(
                      { id: b.id, changes: { isPaused: !b.isPaused } },
                      { onError: () => toast.error(t('transactions:bills.saveFailed', 'Could not save. Try again.')) },
                    )}
                    onStop={() => setStopping(b)}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {adding && <BillForm initial={adding} onClose={() => setAdding(null)} />}
      {editing && <EditBill bill={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        isOpen={!!stopping}
        title={t('transactions:bills.stopTitle', 'Remove this bill?')}
        message={t('transactions:bills.stopMessage', 'It stops reminding you. Entries it already recorded stay in your transactions.')}
        confirmLabel={t('transactions:bills.stop', 'Remove')}
        busy={actions.update.isPending}
        onConfirm={stop}
        onCancel={() => setStopping(null)}
      />
    </DashboardLayout>
  );
}

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between px-1 mb-1.5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}{count ? ` · ${count}` : ''}
        </h2>
      </div>
      {hint && <p className="px-1 mb-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      <Card padding="none" shadow="none" clip className="divide-y divide-gray-100 dark:divide-gray-700">
        {children}
      </Card>
    </section>
  );
}

function useDayLabel() {
  const { t, i18n } = useTranslation('transactions');
  return (iso: string, today: string) => {
    const day = parseDay(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
    if (iso === today) return t('bills.dueToday', 'Due today');
    if (iso < today) return t('bills.overdue', 'Was due {{day}}', { day });
    return t('bills.dueOn', 'Due {{day}}', { day });
  };
}

function BillTitle({ bill }: { bill: Pick<Bill, 'description' | 'category' | 'subcategory'> }) {
  const { t } = useTranslation('transactions');
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 text-lg flex-shrink-0" aria-hidden="true">
        {getCategoryIcon(bill.category)}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{bill.description}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {categoryLabel(bill.category, t)}
          {bill.subcategory && ` · ${subcategoryLabel(bill.subcategory, t)}`}
        </p>
      </div>
    </div>
  );
}

/** One occurrence waiting: record it (with the amount it really was) or skip it. */
function DueRow({ bill, today }: { bill: Bill; today: string }) {
  const { t } = useTranslation('transactions');
  const dayLabel = useDayLabel();
  const { record, skip } = useBillActions();
  const [amount, setAmount] = useState(String(bill.amount));
  const busy = record.isPending || skip.isPending;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      toast(t('bills.alreadyDone', 'Already recorded or skipped.'));
    } else {
      toast.error(t('bills.saveFailed', 'Could not save. Try again.'));
    }
  };

  return (
    <div className="px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <BillTitle bill={bill} />
        <span className={cn(
          'flex-shrink-0 text-xs font-semibold',
          bill.nextOccurrence < today ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400',
        )}>
          {dayLabel(bill.nextOccurrence, today)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`bill-amount-${bill.id}`}>{t('bills.amount', 'Amount')}</label>
        <div className="relative flex-1 min-w-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400">{bill.currency}</span>
          <input
            id={`bill-amount-${bill.id}`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            className={cn(FIELD, 'pl-12 tabular-nums font-semibold')}
          />
        </div>
        <Button
          size="sm"
          variant="primary"
          className="h-11"
          disabled={!valid || busy}
          // mutateAsync, not mutate's callbacks: recording refetches the due list,
          // which unmounts this row, and an unmounted row's callbacks never run.
          onClick={() => record.mutateAsync({ id: bill.id, occurrence: bill.nextOccurrence, amount: value }).then(
            () => toast.success(t('bills.recorded', 'Recorded {{name}}', { name: bill.description })),
            onError,
          )}
        >
          {t('bills.record', 'Record')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11"
          disabled={busy}
          onClick={() => skip.mutateAsync({ id: bill.id, occurrence: bill.nextOccurrence }).catch(onError)}
        >
          {t('bills.skip', 'Skip')}
        </Button>
      </div>
    </div>
  );
}

function useFrequencyLabel() {
  const { t } = useTranslation('transactions');
  return (bill: Pick<Bill, 'frequency' | 'startDate'>) => {
    const day = parseDay(bill.startDate).getDate();
    switch (bill.frequency) {
      case 'weekly': return t('bills.everyWeek', 'Every week');
      case 'quarterly': return t('bills.everyQuarter', 'Every 3 months, day {{day}}', { day });
      case 'yearly': return t('bills.everyYear', 'Every year');
      default: return t('bills.everyMonth', 'Every month, day {{day}}', { day });
    }
  };
}

function BillRow({ bill, onEdit, onTogglePause, onStop }: { bill: Bill; onEdit: () => void; onTogglePause: () => void; onStop: () => void }) {
  const { t } = useTranslation('transactions');
  const { isValueVisible } = usePrivacy();
  const freq = useFrequencyLabel();
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <BillTitle bill={bill} />
        <span className="flex-shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
          {isValueVisible ? formatCurrency(bill.amount, bill.currency, { precision: 0 }) : '•••'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>{freq(bill)}</span>
        {bill.isPaused && (
          <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 font-semibold text-gray-700 dark:text-gray-300">
            {t('bills.paused', 'Paused')}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={onEdit} className="rounded-md px-2 py-1.5 font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {t('bills.edit', 'Edit')}
          </button>
          <button type="button" onClick={onTogglePause} className="rounded-md px-2 py-1.5 font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {bill.isPaused ? t('bills.resume', 'Resume') : t('bills.pause', 'Pause')}
          </button>
          <button type="button" onClick={onStop} className="rounded-md px-2 py-1.5 font-semibold text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500">
            {t('bills.stop', 'Remove')}
          </button>
        </span>
      </div>
    </div>
  );
}

function SuggestionRow({ suggestion: s, onAccept, onDismiss }: { suggestion: BillSuggestion; onAccept: () => void; onDismiss: () => void }) {
  const { t } = useTranslation('transactions');
  const { isValueVisible } = usePrivacy();
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <BillTitle bill={s} />
        <span className="flex-shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
          {isValueVisible ? formatCurrency(s.amount, s.currency, { precision: 0 }) : '•••'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{t('bills.seenIn', 'In {{months}} of the last 6 months, around day {{day}}', { months: s.monthsSeen, day: s.dayOfMonth })}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1.5 font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {t('bills.notABill', 'Not a bill')}
          </button>
          <button type="button" onClick={onAccept} className="rounded-md px-2 py-1.5 font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {t('bills.remindMe', 'Remind me monthly')}
          </button>
        </span>
      </div>
    </div>
  );
}

interface BillDraft {
  description: string;
  amount: string;
  currency: string;
  category: string;
  subcategory: string;
  paymentMethod: string | null;
  frequency: BillFrequency;
  startDate: string;
}

function BillForm({ initial, onClose }: { initial: Partial<BillDraft>; onClose: () => void }) {
  const { t } = useTranslation('transactions');
  const { create } = useBillActions();
  const [draft, setDraft] = useState<BillDraft>({
    description: '', amount: '', currency: 'TWD', category: 'Shopping', subcategory: '',
    paymentMethod: null, frequency: 'monthly', startDate: localDateString(), ...initial,
  });
  const details = SUBCATEGORIES[draft.category] ?? [];
  const value = Number(draft.amount);
  const valid = draft.description.trim() !== '' && Number.isFinite(value) && value > 0 && !!draft.startDate;
  const set = (patch: Partial<BillDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const categoryId = await transactionService.getCategoryIdByName(draft.category);
    if (!categoryId) {
      toast.error(t('bills.saveFailed', 'Could not save. Try again.'));
      return;
    }
    try {
      await create.mutateAsync({
        description: draft.description.trim(), amount: value, currency: draft.currency, categoryId,
        subcategory: draft.subcategory || null, paymentMethod: draft.paymentMethod,
        frequency: draft.frequency, startDate: draft.startDate,
      });
      toast.success(t('bills.added', 'We will remind you on its day.'));
      onClose();
    } catch {
      toast.error(t('bills.saveFailed', 'Could not save. Try again.'));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnOverlay={false}
      size="sm"
      title={t('bills.addTitle', 'Remind me of a bill')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common:common.cancel', 'Cancel')}</Button>
          <Button variant="primary" disabled={!valid || create.isPending} onClick={save}>{t('bills.save', 'Save')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="bill-desc" className={LABEL}>{t('bills.name', 'Name')}</label>
          <input id="bill-desc" data-autofocus className={FIELD} value={draft.description} maxLength={500}
            onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bill-amount" className={LABEL}>{t('bills.usualAmount', 'Usual amount')}</label>
            <input id="bill-amount" inputMode="decimal" className={cn(FIELD, 'tabular-nums')} value={draft.amount}
              onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} />
          </div>
          <div>
            <label htmlFor="bill-start" className={LABEL}>{t('bills.firstDue', 'Next due')}</label>
            <input id="bill-start" type="date" className={FIELD} value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bill-category" className={LABEL}>{t('fields.category', 'Category')}</label>
            <select id="bill-category" className={FIELD} value={draft.category}
              onChange={(e) => set({ category: e.target.value, subcategory: '' })}>
              {CATEGORIES.expense.map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {categoryLabel(c.value, t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bill-frequency" className={LABEL}>{t('bills.repeats', 'Repeats')}</label>
            <select id="bill-frequency" className={FIELD} value={draft.frequency}
              onChange={(e) => set({ frequency: e.target.value as BillFrequency })}>
              <option value="monthly">{t('bills.monthly', 'Monthly')}</option>
              <option value="quarterly">{t('bills.quarterly', 'Every 3 months')}</option>
              <option value="yearly">{t('bills.yearly', 'Yearly')}</option>
              <option value="weekly">{t('bills.weekly', 'Weekly')}</option>
            </select>
          </div>
        </div>
        {details.length > 0 && (
          <div>
            <label htmlFor="bill-detail" className={LABEL}>{t('form.subcategoryLabel', 'Detail')}</label>
            <select id="bill-detail" className={FIELD} value={draft.subcategory}
              onChange={(e) => set({ subcategory: e.target.value })}>
              <option value="">{t('form.paymentNone', 'Not set')}</option>
              {details.map((d) => (
                <option key={d.value} value={d.value}>{d.icon} {subcategoryLabel(d.value, t)}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditBill({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { t } = useTranslation('transactions');
  const { update } = useBillActions();
  const [description, setDescription] = useState(bill.description);
  const [amount, setAmount] = useState(String(bill.amount));
  const [nextDue, setNextDue] = useState(bill.nextOccurrence);
  const value = Number(amount);
  const valid = description.trim() !== '' && Number.isFinite(value) && value > 0 && !!nextDue;

  const changes = useMemo(() => ({
    ...(description.trim() !== bill.description ? { description: description.trim() } : {}),
    ...(value !== bill.amount ? { amount: value } : {}),
    ...(nextDue !== bill.nextOccurrence ? { startDate: nextDue } : {}),
  }), [description, value, nextDue, bill]);

  const save = async () => {
    if (Object.keys(changes).length === 0) return onClose();
    try {
      await update.mutateAsync({ id: bill.id, changes });
      onClose();
    } catch {
      toast.error(t('bills.saveFailed', 'Could not save. Try again.'));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnOverlay={false}
      size="sm"
      title={t('bills.editTitle', 'Edit bill')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common:common.cancel', 'Cancel')}</Button>
          <Button variant="primary" disabled={!valid || update.isPending} onClick={save}>{t('bills.save', 'Save')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="edit-bill-desc" className={LABEL}>{t('bills.name', 'Name')}</label>
          <input id="edit-bill-desc" className={FIELD} value={description} maxLength={500}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-bill-amount" className={LABEL}>{t('bills.usualAmount', 'Usual amount')}</label>
            <input id="edit-bill-amount" inputMode="decimal" className={cn(FIELD, 'tabular-nums')} value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <div>
            <label htmlFor="edit-bill-next" className={LABEL}>{t('bills.firstDue', 'Next due')}</label>
            <input id="edit-bill-next" type="date" className={FIELD} value={nextDue}
              onChange={(e) => setNextDue(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('bills.nextDueHint', 'Later reminders keep the day of the month you pick here.')}
        </p>
      </div>
    </Modal>
  );
}
