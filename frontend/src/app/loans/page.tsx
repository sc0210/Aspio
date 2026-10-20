'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlusIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_PRIMARY } from '@/components/layout/topBarStyles';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { LoansSkeleton } from '@/components/loans/LoansSkeleton';
import { Button } from '@/components/ui/Button';
import { LoanCard } from '@/components/loans/LoanCard';
import { AddLoanModal } from '@/components/loans/AddLoanModal';
import { EditLoanModal } from '@/components/loans/EditLoanModal';
import { RecordPaymentModal } from '@/components/loans/RecordPaymentModal';
import { useLoans, useDeleteLoan } from '@/hooks/useLoans';
import { DebtAccount } from '@/services/loanService';
import { formatCurrency } from '@/utils/formatters';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileLoans } from '@/components/loans/MobileLoans';
import { PayoffPlanner } from '@/components/loans/PayoffPlanner';
import { UpcomingPayments } from '@/components/loans/UpcomingPayments';

function fmt(value: number, currency = 'TWD') {
  return formatCurrency(value, currency, { precision: 0 });
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function DesktopLoansPage() {
  const { t } = useTranslation('loans');
  const { loans, summary, isLoading } = useLoans();
  const deleteLoan = useDeleteLoan();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editLoan, setEditLoan] = useState<DebtAccount | null>(null);
  const [paymentLoan, setPaymentLoan] = useState<DebtAccount | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DebtAccount | null>(null);

  const activeLoans = loans.filter(l => l.status === 'active');
  const paidOffLoans = loans.filter(l => l.status === 'paid_off');

  async function handleDelete(loan: DebtAccount) {
    if (deleteLoan.isPending) return;
    await deleteLoan.mutateAsync(loan.id);
    setDeleteConfirm(null);
  }

  const topBarActions = (
    <button
      onClick={() => setShowAddModal(true)}
      className={TOP_BAR_PRIMARY}
    >
      <PlusIcon className="w-4 h-4" />
      {t('addLoan')}
    </button>
  );

  if (isLoading) {
    // Paint the page shell immediately instead of a full-screen spinner so the
    // route becomes contentful right away (improves LCP / perceived load).
    return <LoansSkeleton />;
  }

  return (
    <DashboardLayout topBarActions={topBarActions}>
      <div className="space-y-6">
        {/* Page header — mobile only */}
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          accent="rose"
          actions={
            <Button
              variant="primary"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowAddModal(true)}
            >
              <PlusIcon className="w-4 h-4 flex-shrink-0" />
              <span>{t('addLoan')}</span>
            </Button>
          }
        />

        {/* Stats grid */}
        {summary && summary.loan_count > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
            <Card padding="sm" accent="rose">
              <div className="flex items-center gap-2 mb-1">
                <BanknotesIcon className="w-4 h-4 text-red-700 dark:text-red-500" />
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('summary.totalDebt')}</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{fmt(summary.total_debt)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('summary.activeLoans')}: {summary.loan_count}
              </p>
            </Card>

            <Card padding="sm" accent="cyan">
              <div className="flex items-center gap-2 mb-1">
                <CreditCardIcon className="w-4 h-4 text-primary-500" />
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('summary.activeLoans')}</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.loan_count}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('summary.totalLoans', { count: loans.length })}
              </p>
            </Card>

            <Card padding="sm" accent="amber">
              <div className="flex items-center gap-2 mb-1">
                <CalendarDaysIcon className="w-4 h-4 text-amber-500" />
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('summary.nextPayment')}</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.next_payment_amount ? fmt(summary.next_payment_amount) : '—'}
              </p>
              {summary.next_payment_date && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('summary.on', { date: fmtDate(summary.next_payment_date) })}
                </p>
              )}
            </Card>
          </div>
        )}

        {/* Every payment due soon — the summary card shows only the next one. */}
        {activeLoans.length > 0 && <UpcomingPayments loans={activeLoans} />}

        {/* When am I debt free — and what would extra money change? */}
        {activeLoans.length > 0 && <PayoffPlanner loans={activeLoans} />}

        {/* Empty state */}
        {!isLoading && loans.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 sm:p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 rounded-full bg-primary-100 dark:bg-primary-900/20 flex items-center justify-center">
                <BanknotesIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary-700 dark:text-primary-400" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t('emptyState.title')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 sm:mb-6">
                {t('emptyState.description')}
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-700 hover:bg-primary-800 text-white font-medium rounded-lg transition-colors shadow-sm w-full sm:w-auto justify-center"
              >
                <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                {t('addFirstLoan')}
              </button>
            </div>
          </div>
        )}

        {/* Active loans */}
        {!isLoading && activeLoans.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('sections.active', { count: activeLoans.length })}
              </h2>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {activeLoans.length} {activeLoans.length === 1 ? t('sections.loan') : t('sections.loans')}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeLoans.map(loan => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  onRecordPayment={setPaymentLoan}
                  onEdit={setEditLoan}
                  onDelete={setDeleteConfirm}
                />
              ))}
            </div>
          </div>
        )}

        {/* Paid off loans */}
        {!isLoading && paidOffLoans.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('sections.paidOff', { count: paidOffLoans.length })}
              </h2>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {paidOffLoans.length} {paidOffLoans.length === 1 ? t('sections.loan') : t('sections.loans')}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paidOffLoans.map(loan => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  onRecordPayment={setPaymentLoan}
                  onEdit={setEditLoan}
                  onDelete={setDeleteConfirm}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && <AddLoanModal onClose={() => setShowAddModal(false)} />}

      {editLoan && (
        <EditLoanModal
          loan={editLoan}
          onClose={() => setEditLoan(null)}
        />
      )}

      {paymentLoan && (
        <RecordPaymentModal
          loan={paymentLoan}
          onClose={() => setPaymentLoan(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('deleteModal.title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('deleteModal.confirmPrefix', 'This will remove')}{' '}
              <strong className="text-gray-700 dark:text-gray-200">{deleteConfirm.name}</strong>
              {'. '}{t('deleteModal.confirmSuffix', 'Payment history linked to this loan will be preserved in your transactions.')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteLoan.isPending}
                className="flex-1 py-2.5 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 touch-manipulation"
              >
                {t('deleteModal.cancel')}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteLoan.isPending}
                className="flex-1 py-2.5 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition-colors disabled:opacity-50 touch-manipulation"
              >
                {deleteLoan.isPending ? t('deleteModal.removing') : t('deleteModal.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

/**
 * Breakpoint switch (#344): phones (< md) get MobileLoans — total debt and the next
 * payment, then each active loan with a Pay button; tablet/desktop get the full page.
 * `isMobile` is null until resolved, so show the skeleton rather than a blank frame.
 */
export default function LoansPage() {
  const isMobile = useIsMobile();
  if (isMobile === null) return <LoansSkeleton />;
  return isMobile ? <MobileLoans /> : <DesktopLoansPage />;
}
