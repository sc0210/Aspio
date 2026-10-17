'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { transactionService } from '@/services/transactionService';
import { log } from '@/utils/logger';
import toast from 'react-hot-toast';

/**
 * Manages import/export modal visibility and the bulk import logic.
 *
 * `getExistingTransactions` is called lazily (replace mode only) so the page
 * no longer has to keep the full row set in memory just in case an import
 * happens — it fetches the rows on demand.
 */
export function useTransactionImport(
  getExistingTransactions: () => Promise<Array<{ id: string }>>,
) {
  const queryClient = useQueryClient();
  const [showImportExport, setShowImportExport] = useState(false);

  const handleBulkImport = async (transactions: Record<string, unknown>[], mode: 'append' | 'replace') => {
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ date: string; error: string }> = [];

    // If replace mode, delete all existing transactions first
    if (mode === 'replace') {
      toast.loading('Preparing existing transactions...', { id: 'bulk-import' });
      let existingTransactions: Array<{ id: string }> = [];
      try {
        existingTransactions = await getExistingTransactions();
      } catch (error) {
        log.error('Failed to load existing transactions for replace import', error, 'TransactionsPage');
      }

      if (existingTransactions.length > 0) {
        toast.loading(`Deleting ${existingTransactions.length} existing transactions...`, { id: 'bulk-import' });

        for (const transaction of existingTransactions) {
          try {
            await transactionService.deleteTransaction(transaction.id);
          } catch (error) {
            log.error(`Failed to delete transaction ${transaction.id}`, error, 'TransactionsPage');
          }
        }
      }
    }

    // Import new transactions in parallel batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);
      const processed = Math.min(i + BATCH_SIZE, transactions.length);
      toast.loading(`Importing... ${processed}/${transactions.length}`, { id: 'bulk-import' });

      const results = await Promise.allSettled(
        batch.map(txn => transactionService.createTransaction({
          date: txn.date as string | Date,
          type: txn.type as 'income' | 'expense' | 'transfer',
          amount: txn.amount as number,
          currency: txn.currency as string,
          category: txn.category as string,
          description: txn.description as string,
          paymentMethod: txn.paymentMethod as string | undefined,
          tags: txn.tags as string[] | undefined,
        }))
      );

      results.forEach((result, j) => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          errorCount++;
          const error = result.reason;
          errors.push({ date: batch[j].date as string, error: error?.message || 'Unknown error' });
          log.error(`Failed to import transaction for ${batch[j].date as string}`, error, 'TransactionsPage');
        }
      });
    }

    // Refresh data
    await queryClient.refetchQueries({ queryKey: ['transactions'] });

    toast.dismiss('bulk-import');

    if (errorCount === 0) {
      toast.success(`Successfully imported ${successCount} transactions!`);
    } else {
      toast.error(
        `Imported ${successCount} transactions with ${errorCount} errors. Check console for details.`,
        { duration: 5000 },
      );
      log.error('Import errors', errors, 'TransactionsPage');
    }
  };

  return { showImportExport, setShowImportExport, handleBulkImport };
}
