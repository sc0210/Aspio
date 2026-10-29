'use client';

import { useState, useRef, type JSX } from 'react';
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
import { getPublicApiUrl } from '@/lib/api-url';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { portfolioService } from '@/services/portfolioService';
import { formatCurrency } from '@/utils/formatters';
import {
  parsePortfolioCSV,
  validatePortfolioImportData,
  ValidatedHolding,
} from '@/utils/portfolioCsvUtils';
import { useDialog } from '@/hooks/useDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Holding {
  id?: string;
  symbol: string;
  name: string;
  type: string;
  quantity: number;
  averageCost: number;
  currentPrice?: number;
  currency: string;
  exchange: string;
  sector?: string;
  purchaseDate?: string;
}

interface ImportExportModalProps {
  holdings?: Holding[];
  onClose: () => void;
  /** Legacy callback — if provided, delegates the actual API call to the parent */
  onImport?: (holdings: Omit<Holding, 'id' | 'currentPrice'>[], mode: 'append' | 'replace') => Promise<void>;
  /** Called after a successful import (new API used by PortfolioModalsContainer) */
  onImportSuccess?: () => void;
  /** Unused — parent controls visibility via conditional render */
  isOpen?: boolean;
}

type DatePreset = 'last30' | 'last90' | 'thisYear' | 'lastYear' | 'custom' | 'all';

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
  if (preset === 'thisYear') {
    return { from: `${today.getFullYear()}-01-01`, to };
  }
  if (preset === 'lastYear') {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: '', to: '' };
}

export function ImportExportModal({ holdings = [], onClose, onImport, onImportSuccess }: ImportExportModalProps) {
  const { panelRef, dialogProps } = useDialog({ isOpen: true, onClose: onClose });
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ValidatedHolding[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation(['portfolio']);

  const getExportDates = () => {
    if (datePreset === 'all') return { from: undefined, to: undefined };
    if (datePreset === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
    const { from, to } = getPresetDates(datePreset);
    return { from, to };
  };

  // Export holdings to CSV via backend (with date range)
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { from, to } = getExportDates();
      await portfolioService.downloadCSV(from, to);
      toast.success('Portfolio holdings exported to XLSX');
    } catch (err: unknown) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Download the XLSX template from the backend.
  // Served as XLSX (not a client-side CSV) so the StockID column is text-formatted —
  // Excel keeps leading-zero Taiwan tickers (e.g. 0050) instead of coercing them to 50.
  const handleDownloadTemplate = async () => {
    try {
      await portfolioService.downloadTemplate();
      toast.success(t('portfolio:toast.csvTemplateDownloaded'));
    } catch (err: unknown) {
      toast.error(`Template download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const parseCSV = (text: string) => parsePortfolioCSV(text);
  const validateImportData = (data: ReturnType<typeof parsePortfolioCSV>) => validatePortfolioImportData(data);

  // Handle file upload — accepts both .csv and .xlsx.
  // CSV is parsed client-side; XLSX is sent to the backend (avoids xlsx npm dep).
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    const isCsv  = file.name.toLowerCase().endsWith('.csv');

    if (!isXlsx && !isCsv) {
      toast.error('Please upload a .csv or .xlsx file');
      return;
    }

    setIsImporting(true);

    try {
      let valid: ValidatedHolding[];
      let errors: string[];

      if (isXlsx) {
        // Backend parses XLSX with openpyxl and returns structured JSON
        const { getSession } = await import('next-auth/react');
        const session = await getSession();
        const token = (session as unknown as Record<string, unknown>)?.accessToken;
        const baseUrl = getPublicApiUrl();
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${baseUrl}/portfolio/import-preview`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'ngrok-skip-browser-warning': 'true',
          },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Server error ${res.status}`);
        }
        const data = await res.json() as { holdings: ValidatedHolding[]; errors: string[] };
        valid  = data.holdings;
        errors = data.errors;
      } else {
        const text = await file.text();
        const parsed = parseCSV(text);
        ({ valid, errors } = validateImportData(parsed));
      }

      setImportPreview(valid);
      setImportErrors(errors);

      if (errors.length > 0) {
        toast.error(`Found ${errors.length} validation errors`);
      } else {
        toast.success(`Preview: ${valid.length} holdings ready to import`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to parse file: ${msg}`);
      setImportErrors([msg]);
    } finally {
      setIsImporting(false);
    }
  };

  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  // Execute import
  const handleConfirmImport = async () => {
    if (importPreview.length === 0) {
      toast.error(t('portfolio:toast.noValidHoldingsToImport'));
      return;
    }

    if (importMode === 'replace') {
      setConfirmingReplace(true);
      return;
    }
    await runImport();
  };

  const runImport = async () => {
    setIsImporting(true);
    setImportProgress({ done: 0, total: importPreview.length });

    try {
      if (onImport) {
        await onImport(importPreview, importMode);
      } else {
        if (importMode === 'replace') {
          for (const h of holdings) {
            if (h.id) await portfolioService.deleteHolding(h.id);
          }
        }

        const rowErrors: string[] = [];
        let successCount = 0;

        for (let i = 0; i < importPreview.length; i++) {
          const h = importPreview[i];
          try {
            await portfolioService.addHolding(h as never, { aggregate: false });
            successCount++;
          } catch (err: unknown) {
            rowErrors.push(`Row ${i + 2} (${h.symbol}): ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
          setImportProgress({ done: i + 1, total: importPreview.length });
        }

        if (rowErrors.length > 0) {
          setImportErrors(prev => [...prev, ...rowErrors]);
          toast.error(`Imported ${successCount} of ${importPreview.length} holdings — ${rowErrors.length} failed`);
        } else {
          toast.success(
            importMode === 'replace'
              ? `Replaced all holdings with ${successCount} new lots`
              : `Successfully imported ${successCount} lot${successCount !== 1 ? 's' : ''}`
          );
          setImportPreview([]);
          setImportErrors([]);
          onImportSuccess?.();
          onClose();
        }
        return;
      }

      toast.success(
        importMode === 'replace'
          ? `Replaced all holdings with ${importPreview.length} new holdings`
          : `Successfully imported ${importPreview.length} holdings`
      );
      setImportPreview([]);
      setImportErrors([]);
      onImportSuccess?.();
      onClose();
    } catch (error: unknown) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
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
                  Import / Export Holdings
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Import holdings from CSV or XLSX, or export your current portfolio
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
                    Export Holdings
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Download your portfolio holdings as an XLSX file. Filter by purchase date range.
                  </p>

                  {/* Date Range Selector */}
                  <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700">
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarDaysIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Purchase Date Range</span>
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
                          <label htmlFor="importexpo-from" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                          <input
                            id="importexpo-from"
                            type="date"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        </div>
                        <div className="flex-1">
                          <label htmlFor="importexpo-to" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                          <input
                            id="importexpo-to"
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
                    {isExporting ? 'Exporting...' : 'Export to Excel (XLSX)'}
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
                    Import Holdings
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Upload a CSV or XLSX file with your holdings. You can re-import the exported XLSX directly.
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
                            Keep current holdings and add new ones
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
                            Remove all current holdings before importing
                          </div>
                        </div>
                      </label>
                    </div>

                    {importMode === 'replace' && (
                      <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg">
                        <p className="text-xs text-orange-800 dark:text-orange-300 font-semibold">
                          ⚠️ Warning: This will delete all {holdings.length} existing holdings before importing!
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
                      {isImporting ? 'Processing...' : 'Choose File (CSV / XLSX)'}
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
                      accept=".csv,.xlsx"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>

                  {/* CSV Format Info */}
                  <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-300 dark:border-green-700">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Columns (CSV or XLSX trade log format):
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <span className="text-gray-600 dark:text-gray-400">• Date <span className="text-gray-500 dark:text-gray-400">(YYYY/MM/DD)</span></span>
                      <span className="text-gray-600 dark:text-gray-400">• Type <span className="text-gray-500 dark:text-gray-400">(買入 / 賣出)</span></span>
                      <span className="text-gray-600 dark:text-gray-400">• StockID</span>
                      <span className="text-gray-600 dark:text-gray-400">• Currency <span className="text-gray-500 dark:text-gray-400">(TWD / USD)</span></span>
                      <span className="text-gray-600 dark:text-gray-400">• Shares</span>
                      <span className="text-gray-600 dark:text-gray-400">• Price per shares <span className="text-gray-500 dark:text-gray-400">(plain number)</span></span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">Net income is optional and ignored on import. Sell rows are skipped.</p>
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
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircleIcon className="w-5 h-5 text-green-700 dark:text-green-400" />
                      <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                        {importPreview.length} valid lot{importPreview.length > 1 ? 's' : ''} ready to import
                        {(() => {
                          const uniqueSymbols = new Set(importPreview.map(h => h.symbol)).size;
                          const multipleLots = uniqueSymbols < importPreview.length;
                          return multipleLots ? ` (${uniqueSymbols} unique symbol${uniqueSymbols > 1 ? 's' : ''})` : '';
                        })()}
                      </p>
                    </div>

                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Date</th>
                            <th className="px-3 py-2 text-center font-semibold">StockID</th>
                            <th className="px-3 py-2 text-left font-semibold">Currency</th>
                            <th className="px-3 py-2 text-right font-semibold">Shares</th>
                            <th className="px-3 py-2 text-right font-semibold">Price/share</th>
                            <th className="px-3 py-2 text-right font-semibold">Net</th>
                            <th className="px-3 py-2 text-center font-semibold">Lot</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {(() => {
                            // Group lots by symbol for visual grouping
                            const symbolGroups = new Map<string, typeof importPreview>();
                            importPreview.forEach(row => {
                              const key = row.symbol;
                              if (!symbolGroups.has(key)) {
                                symbolGroups.set(key, []);
                              }
                              symbolGroups.get(key)!.push(row);
                            });

                            const rows: JSX.Element[] = [];
                            symbolGroups.forEach((lots, symbol) => {
                              lots.forEach((row, lotIndex) => {
                                const isMultipleLots = lots.length > 1;
                                const isFirstLot = lotIndex === 0;
                                const isLastLot = lotIndex === lots.length - 1;

                                rows.push(
                                  <tr
                                    key={`${symbol}-${lotIndex}`}
                                    className={cn(
                                      "hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors",
                                      isMultipleLots && "bg-blue-50/30 dark:bg-blue-900/10",
                                      isMultipleLots && !isLastLot && "border-b border-blue-200 dark:border-blue-800"
                                    )}
                                  >
                                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                                      {row.purchaseDate || 'Not set'}
                                    </td>
                                    <td className={cn(
                                      "px-3 py-2 font-medium text-center",
                                      isMultipleLots && isFirstLot && "border-l-4 border-blue-500"
                                    )}>
                                      {row.symbol}
                                    </td>
                                    <td className="px-3 py-2">{row.currency}</td>
                                    <td className="px-3 py-2 text-right">{row.quantity}</td>
                                    <td className="px-3 py-2 text-right">{row.averageCost}</td>
                                    <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">
                                      {`-${formatCurrency(row.quantity * row.averageCost, row.currency)}`}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      {isMultipleLots && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                          {lotIndex + 1}/{lots.length}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              });
                            });

                            return rows;
                          })()}
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
                        {importProgress
                          ? `Importing ${importProgress.done}/${importProgress.total}...`
                          : isImporting
                            ? 'Importing...'
                            : `Import ${importPreview.length} Lot${importPreview.length !== 1 ? 's' : ''}`}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setImportPreview([]);
                          setImportErrors([]);
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
        title={t('portfolio:importReplaceConfirm.title')}
        message={t('portfolio:importReplaceConfirm.message', { existing: holdings.length, incoming: importPreview.length })}
        confirmLabel={t('portfolio:importReplaceConfirm.confirm')}
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          runImport();
        }}
      />
    </>
  );
}
