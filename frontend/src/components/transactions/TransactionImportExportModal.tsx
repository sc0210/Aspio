'use client';

import { useState, useRef } from 'react';
import {
  XMarkIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  DocumentArrowDownIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { transactionService } from '@/services/transactionService';
import { useDialog } from '@/hooks/useDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Transaction {
  id?: string;
  date: string | Date;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  category: string;
  description?: string;
  paymentMethod?: string;
  tags?: string[];
}

interface TransactionImportExportModalProps {
  transactions: Transaction[];
  onClose: () => void;
  onImport: (transactions: Omit<Transaction, 'id'>[], mode: 'append' | 'replace') => Promise<void>;
}

type DatePreset = 'last30' | 'last90' | 'thisYear' | 'lastYear' | 'custom' | 'all';

interface ParsedRow {
  date?: string;
  type?: string;
  amount?: number;
  currency?: string;
  category?: string;
  description?: string;
  paymentMethod?: string;
  tags?: string[];
}

function getPresetDates(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const to = fmt(today);
  if (preset === 'last30') {
    const from = new Date(today); from.setDate(from.getDate() - 30);
    return { from: fmt(from), to };
  }
  if (preset === 'last90') {
    const from = new Date(today); from.setDate(from.getDate() - 90);
    return { from: fmt(from), to };
  }
  if (preset === 'thisYear') return { from: `${today.getFullYear()}-01-01`, to };
  if (preset === 'lastYear') {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: '', to: '' };
}

export function TransactionImportExportModal({ transactions, onClose, onImport }: TransactionImportExportModalProps) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });
  const { t } = useTranslation(['transactions']);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ParsedRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [duplicateIndices, setDuplicateIndices] = useState<Set<number>>(new Set());
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getExportDates = () => {
    if (datePreset === 'all') return { from: undefined, to: undefined };
    if (datePreset === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
    const { from, to } = getPresetDates(datePreset);
    return { from, to };
  };

  // Export transactions to CSV via backend (with date range)
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { from, to } = getExportDates();
      await transactionService.downloadCSV(from, to);
      toast.success('Transactions exported to CSV');
    } catch (err: unknown) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Download CSV template
  const handleDownloadTemplate = () => {
    const templateHeaders = [
      'Date',
      'Type',
      'Amount',
      'Currency',
      'Category',
      'Description',
      'Payment Method',
      'Tags'
    ];

    const templateRows = [
      ['2024-01-15', 'expense', '1500', 'TWD', '飲食', '午餐', '信用卡', '商務;餐飲'],
      ['2024-01-20', 'income', '50000', 'TWD', '薪資', '月薪', '銀行轉帳', ''],
      ['2024-02-05', 'expense', '2500', 'TWD', '交通', '計程車', '現金', '商務;交通']
    ];

    const csvContent = [
      templateHeaders.join(','),
      ...templateRows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'transactions_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(t('transactions:toast.csvTemplateDownloaded'));
  };

  // Parse CSV file — RFC 4180 compliant: handles quoted fields with embedded commas/newlines
  const parseCSV = (text: string): ParsedRow[] => {
    // Split text respecting quoted fields (newlines inside quotes stay in the field)
    const splitLines = (raw: string): string[] => {
      const result: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '"') { inQ = !inQ; cur += raw[i]; }
        else if (!inQ && (raw[i] === '\n' || raw[i] === '\r')) {
          if (cur.trim()) result.push(cur);
          cur = '';
          if (raw[i] === '\r' && raw[i + 1] === '\n') i++;
        } else { cur += raw[i]; }
      }
      if (cur.trim()) result.push(cur);
      return result;
    };

    // Parse a single CSV row into fields
    const parseRow = (line: string): string[] => {
      const fields: string[] = [];
      let i = 0;
      while (i <= line.length) {
        if (i === line.length) { fields.push(''); break; }
        if (line[i] === '"') {
          let field = ''; i++;
          while (i < line.length) {
            if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
            else if (line[i] === '"') { i++; break; }
            else { field += line[i++]; }
          }
          fields.push(field.trim());
          if (line[i] === ',') i++;
        } else {
          const end = line.indexOf(',', i);
          if (end === -1) { fields.push(line.slice(i).trim()); break; }
          fields.push(line.slice(i, end).trim());
          i = end + 1;
        }
      }
      return fields;
    };

    const lines = splitLines(text);
    if (lines.length < 2) throw new Error('CSV file is empty or has no data rows');

    const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, '').toLowerCase());
    const rows: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseRow(lines[i]);
      const row: ParsedRow = {};

      headers.forEach((header, index) => {
        const value = values[index] || '';

        // Map CSV headers to object properties
        switch (header.toLowerCase()) {
          case 'date':
            row.date = value;
            break;
          case 'type':
            row.type = value.toLowerCase();
            break;
          case 'amount':
            row.amount = parseFloat(value);
            break;
          case 'currency':
            row.currency = value.toUpperCase() || 'TWD';
            break;
          case 'category':
            row.category = value;
            break;
          case 'description':
            row.description = value || undefined;
            break;
          case 'payment method':
          case 'paymentmethod':
            row.paymentMethod = value || undefined;
            break;
          case 'tags':
            row.tags = value ? value.split(';').map(t => t.trim()).filter(Boolean) : undefined;
            break;
        }
      });

      rows.push(row);
    }

    return rows;
  };

  // Validate imported data
  const validateImportData = (data: ParsedRow[]): { valid: ParsedRow[], errors: string[] } => {
    const valid: ParsedRow[] = [];
    const errors: string[] = [];

    data.forEach((row, index) => {
      const rowNum = index + 2; // +2 because index 0 is row 2 (after header)

      // Required fields
      if (!row.date) {
        errors.push(`Row ${rowNum}: Date is required`);
        return;
      }

      // Validate date format
      const date = new Date(row.date);
      if (isNaN(date.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date format. Use YYYY-MM-DD`);
        return;
      }

      if (!row.type) {
        errors.push(`Row ${rowNum}: Type is required`);
        return;
      }

      // Validate type
      if (!['income', 'expense', 'transfer'].includes(row.type.toLowerCase())) {
        errors.push(`Row ${rowNum}: Type must be "income", "expense", or "transfer"`);
        return;
      }

      if (isNaN(row.amount ?? NaN) || (row.amount ?? 0) <= 0) {
        errors.push(`Row ${rowNum}: Amount must be a positive number`);
        return;
      }

      if (!row.category) {
        errors.push(`Row ${rowNum}: Category is required`);
        return;
      }

      valid.push(row);
    });

    return { valid, errors };
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast.error(t('transactions:toast.uploadCsvFile'));
      return;
    }

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = parseCSV(text);
        const { valid, errors } = validateImportData(parsed);

        // Detect potential duplicates: same date + amount + category as an existing transaction
        const existingKeys = new Set(
          transactions.map(t => `${t.date?.toString().slice(0, 10)}|${t.amount}|${t.category}`)
        );
        const dupes = new Set<number>();
        valid.forEach((row, i) => {
          const key = `${row.date?.slice(0, 10)}|${row.amount}|${row.category}`;
          if (existingKeys.has(key)) dupes.add(i);
        });

        setImportPreview(valid);
        setImportErrors(errors);
        setDuplicateIndices(dupes);

        if (errors.length > 0) {
          toast.error(`Found ${errors.length} validation errors`);
        } else if (dupes.size > 0) {
          toast(`Preview: ${valid.length} transactions (${dupes.size} possible duplicate${dupes.size > 1 ? 's' : ''})`, { icon: '⚠️' });
        } else {
          toast.success(`Preview: ${valid.length} transactions ready to import`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to parse file';
        toast.error(`Failed to parse CSV: ${msg}`);
        setImportErrors([msg]);
      } finally {
        setIsImporting(false);
      }
    };

    reader.onerror = () => {
      toast.error(t('transactions:toast.fileReadFailed'));
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  // Execute import
  const handleConfirmImport = async () => {
    if (importPreview.length === 0) {
      toast.error(t('transactions:toast.noValidTransactionsToImport'));
      return;
    }

    // Confirm if replace mode
    if (importMode === 'replace') {
      setConfirmingReplace(true);
      return;
    }
    await runImport();
  };

  const runImport = async () => {
    try {
      setIsImporting(true);
      await onImport(importPreview as unknown as Omit<Transaction, 'id'>[], importMode);

      if (importMode === 'replace') {
        toast.success(`Successfully replaced all transactions with ${importPreview.length} new transactions`);
      } else {
        toast.success(`Successfully imported ${importPreview.length} transactions`);
      }

      setImportPreview([]);
      setImportErrors([]);
      onClose();
    } catch (error: unknown) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          {...dialogProps}
          className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-4xl shadow-2xl border border-gray-200 dark:border-gray-700 animate-slide-up max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 z-10">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {t('transactions:importExport.title')}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Bulk import transactions from CSV or export your current transactions
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-gray-500 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all"
                aria-label="Close"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Export Section */}
            <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                  <ArrowDownTrayIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Export Transactions
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Download your transactions as a CSV file. Filter by date range to get exactly the data you need.
                  </p>

                  {/* Date Range Selector */}
                  <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700">
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarDaysIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Date Range</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(['all', 'last30', 'last90', 'thisYear', 'lastYear', 'custom'] as DatePreset[]).map(p => (
                        <button
                          key={p}
                          onClick={() => setDatePreset(p)}
                          className={cn(
                            'px-3 py-1.5 text-xs font-medium rounded-lg border transition-all',
                            datePreset === p
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                          )}
                        >
                          {p === 'all' ? 'All Time' : p === 'last30' ? 'Last 30 days' : p === 'last90' ? 'Last 90 days' : p === 'thisYear' ? 'This Year' : p === 'lastYear' ? 'Last Year' : 'Custom'}
                        </button>
                      ))}
                    </div>
                    {datePreset === 'custom' && (
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label htmlFor="transactio-from" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                          <input
                            id="transactio-from"
                            type="date"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        </div>
                        <div className="flex-1">
                          <label htmlFor="transactio-to" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                          <input
                            id="transactio-to"
                            type="date"
                            value={customTo}
                            onChange={e => setCustomTo(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>
                    )}
                    {datePreset !== 'all' && datePreset !== 'custom' && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {(() => { const { from, to } = getPresetDates(datePreset); return `${from} → ${to}`; })()}
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleExport}
                    disabled={isExporting}
                    isLoading={isExporting}
                    leftIcon={<DocumentArrowDownIcon className="w-5 h-5" />}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isExporting ? 'Exporting...' : 'Export to CSV'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Import Section */}
            <div className="p-6 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-xl">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-100 dark:bg-green-900/40 rounded-lg">
                  <ArrowUpTrayIcon className="w-6 h-6 text-green-700 dark:text-green-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Import Transactions
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Upload a CSV file with your transactions. Make sure it follows the correct format.
                  </p>

                  {/* Import Mode Selection */}
                  <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-green-300 dark:border-green-700">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      Import Mode:
                    </p>
                    <div className="flex gap-3">
                      <label className="flex-1 flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all hover:bg-green-50 dark:hover:bg-green-900/20"
                        style={{
                          borderColor: importMode === 'append' ? '#10b981' : '#d1d5db',
                          backgroundColor: importMode === 'append' ? 'rgb(16 185 129 / 0.05)' : 'transparent'
                        }}
                      >
                        <input
                          type="radio"
                          name="importMode"
                          value="append"
                          checked={importMode === 'append'}
                          onChange={(e) => setImportMode(e.target.value as 'append' | 'replace')}
                          className="w-4 h-4 text-green-700 dark:text-green-600"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            Append (Add to existing)
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            Keep current transactions and add new ones
                          </div>
                        </div>
                      </label>

                      <label className="flex-1 flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all hover:bg-orange-50 dark:hover:bg-orange-900/20"
                        style={{
                          borderColor: importMode === 'replace' ? '#f97316' : '#d1d5db',
                          backgroundColor: importMode === 'replace' ? 'rgb(249 115 22 / 0.05)' : 'transparent'
                        }}
                      >
                        <input
                          type="radio"
                          name="importMode"
                          value="replace"
                          checked={importMode === 'replace'}
                          onChange={(e) => setImportMode(e.target.value as 'append' | 'replace')}
                          className="w-4 h-4 text-orange-700 dark:text-orange-600"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            Replace (Delete all first)
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            Remove all current transactions before importing
                          </div>
                        </div>
                      </label>
                    </div>

                    {importMode === 'replace' && (
                      <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg">
                        <p className="text-xs text-orange-800 dark:text-orange-300 font-semibold">
                          ⚠️ Warning: This will delete all {transactions.length} existing transactions before importing!
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 mb-4">
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      leftIcon={<DocumentTextIcon className="w-5 h-5" />}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isImporting ? 'Processing...' : 'Choose CSV File'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleDownloadTemplate}
                    >
                      Download Template
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>

                  {/* CSV Format Info */}
                  <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-300 dark:border-green-700">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Required CSV Columns:
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <span className="text-gray-600 dark:text-gray-400">• Date</span>
                      <span className="text-gray-600 dark:text-gray-400">• Type</span>
                      <span className="text-gray-600 dark:text-gray-400">• Amount</span>
                      <span className="text-gray-600 dark:text-gray-400">• Currency</span>
                      <span className="text-gray-600 dark:text-gray-400">• Category</span>
                      <span className="text-gray-600 dark:text-gray-400">• Description (optional)</span>
                      <span className="text-gray-600 dark:text-gray-400">• Payment Method (optional)</span>
                      <span className="text-gray-600 dark:text-gray-400">• Tags (optional)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Import Preview */}
            {(importPreview.length > 0 || importErrors.length > 0) && (
              <div className="border-2 border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                    Import Preview
                  </h4>
                </div>

                {/* Errors */}
                {importErrors.length > 0 && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
                    <div className="flex items-start gap-3">
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                          {importErrors.length} Validation Error{importErrors.length > 1 ? 's' : ''}:
                        </p>
                        <ul className="text-xs text-red-700 dark:text-red-400 space-y-1">
                          {importErrors.slice(0, 10).map((error, i) => (
                            <li key={i}>• {error}</li>
                          ))}
                          {importErrors.length > 10 && (
                            <li className="font-semibold">... and {importErrors.length - 10} more errors</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Valid rows preview */}
                {importPreview.length > 0 && (
                  <div className="p-4">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon className="w-5 h-5 text-green-700 dark:text-green-400" />
                        <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                          {importPreview.length} valid transaction{importPreview.length > 1 ? 's' : ''} ready to import
                        </p>
                      </div>
                      {duplicateIndices.size > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                          <ExclamationTriangleIcon className="w-4 h-4 text-yellow-700 dark:text-yellow-400" />
                          <span className="text-xs font-semibold text-yellow-800 dark:text-yellow-300">
                            {duplicateIndices.size} possible duplicate{duplicateIndices.size > 1 ? 's' : ''} (highlighted)
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Date</th>
                            <th className="px-3 py-2 text-left font-semibold">Type</th>
                            <th className="px-3 py-2 text-right font-semibold">Amount</th>
                            <th className="px-3 py-2 text-left font-semibold">Currency</th>
                            <th className="px-3 py-2 text-left font-semibold">Category</th>
                            <th className="px-3 py-2 text-left font-semibold">Description</th>
                            <th className="px-3 py-2 text-left font-semibold">Payment Method</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {importPreview.map((row, index) => (
                            <tr key={index} className={cn(
                              "transition-colors",
                              duplicateIndices.has(index)
                                ? "bg-yellow-50 dark:bg-yellow-900/10 hover:bg-yellow-100 dark:hover:bg-yellow-900/20"
                                : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                            )}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  {duplicateIndices.has(index) && (
                                    <ExclamationTriangleIcon className="w-3.5 h-3.5 text-yellow-700 dark:text-yellow-500 flex-shrink-0" title="Possible duplicate" />
                                  )}
                                  {row.date}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-xs font-medium",
                                  row.type === 'income'
                                    ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
                                    : 'bg-error-100 dark:bg-error-900/30 text-error-700 dark:text-error-300'
                                )}>
                                  {row.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-medium">{row.amount}</td>
                              <td className="px-3 py-2">{row.currency}</td>
                              <td className="px-3 py-2">{row.category}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.description || '-'}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.paymentMethod || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 flex gap-3">
                      <Button
                        onClick={handleConfirmImport}
                        disabled={isImporting}
                        isLoading={isImporting}
                        leftIcon={<CheckCircleIcon className="w-5 h-5" />}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        {isImporting ? 'Importing...' : `Import ${importPreview.length} Transactions`}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setImportPreview([]);
                          setImportErrors([]);
                          setDuplicateIndices(new Set());
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmingReplace}
        title={t('transactions:importExport.replaceConfirm.title')}
        message={t('transactions:importExport.replaceConfirm.message', { existing: transactions.length, incoming: importPreview.length })}
        confirmLabel={t('transactions:importExport.replaceConfirm.confirm')}
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          runImport();
        }}
      />
    </>
  );
}

