'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  CameraIcon,
  PhotoIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatCurrency, localDateString } from '@/utils/formatters';
import { QUERY_KEYS, invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { toBackendPaymentMethod } from '@/utils/paymentMethods';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { transactionService } from '@/services/transactionService';
import { useModeAwareUI } from '@/hooks/useAppMode';

interface ExtractedData {
  merchant: string;
  amount: number;
  date: string;
  items: Array<{
    name: string;
    price: number;
    quantity: number;
  }>;
  paymentMethod?: string;
  receiptType: 'receipt' | 'invoice' | 'qr_payment' | 'unknown';
  confidence: number;
}

export default function ScanReceiptPage() {
  const router = useRouter();
  const { t } = useTranslation(['transactions']);
  const { isDemo } = useModeAwareUI();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const createTransactionMutation = useMutation({
    // Through the service, which maps to the backend's TransactionCreate
    // (transaction_date, category_name/category_id, snake_case payment_method).
    // This page used to post its own shape — a Date under `date`, camelCase
    // paymentMethod, a category the backend never reads — and every save 422'd.
    mutationFn: async (data: ExtractedData) => {
      const response = await transactionService.createTransaction({
        type: 'expense',
        amount: data.amount,
        currency: 'TWD',
        category: 'Others',
        description: data.merchant
          ? t('transactions:scan.purchaseAt', { merchant: data.merchant })
          : t('transactions:scan.receiptPurchase'),
        date: new Date(data.date),
        walletType: 'life',
        paymentMethod: toBackendPaymentMethod(data.paymentMethod),
        tags: ['receipt-scanned'],
      } as Parameters<typeof transactionService.createTransaction>[0]);
      if (!response.success) throw new Error(response.message);
      return response.data;
    },
    onSuccess: async () => {
      // As /transactions/add does: otherwise the list the user lands on is the
      // cached one, without the transaction just saved.
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.TRANSACTIONS] });
      invalidateDashboardData(queryClient);
      toast.success(t('transactions:toast.created'));
      router.push('/transactions');
    },
    onError: () => {
      toast.error(t('transactions:toast.createFailed'));
    },
  });

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('transactions:toast.selectImageFile'));
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      toast.error(t('transactions:toast.fileTooLarge'));
      return;
    }

    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setExtractedData(null);
  }, [t]);

  const handleCameraCapture = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    };
    input.click();
  };

  // This used to invent a receipt: a 3s fake delay, then a hardcoded
  // "NTUC FairPrice / $45.80" at confidence 0.92 and a success toast. The
  // backend was never called. Anyone photographing a real receipt got a
  // plausible-looking form pre-filled with numbers that came from nowhere, and
  // could save them straight into their ledger.
  //
  // It now calls the endpoint that already existed. No OCR provider is wired up
  // behind it yet, so the honest outcome today is a 501 and the manual-entry
  // path below — not a fabricated success.
  const handleProcessReceipt = async () => {
    if (!selectedFile) return;

    // Demo mode has no session, so the upload would only come back 401. Say
    // what it takes instead. Saving is unreachable from here too: without a
    // scan there is no extracted data to confirm.
    if (isDemo) {
      toast(t('transactions:scan.demoLocked'), { icon: 'ℹ️' });
      return;
    }

    setIsProcessing(true);
    setScanFailed(false);
    try {
      const response = await transactionService.scanReceipt(selectedFile);
      // The endpoint answers in the backend's own shape (snake_case,
      // merchant_name) rather than this page's ExtractedData, so map rather
      // than cast — a cast leaves merchant silently blank.
      const parsed = response.data as
        | { amount?: number; merchant_name?: string; date?: string; confidence?: number }
        | undefined;

      // Only accept a reading that actually carries an amount. OCR returns
      // nulls whenever no line named a total, and that is not something to
      // pre-fill a money field with.
      if (!parsed || typeof parsed.amount !== 'number') {
        setScanFailed(true);
        return;
      }

      setExtractedData({
        merchant: parsed.merchant_name ?? '',
        amount: parsed.amount,
        date: parsed.date ?? localDateString(),
        // The OCR path reports totals, not line items — the itemised view stays
        // empty rather than inventing rows.
        items: [],
        receiptType: 'receipt',
        confidence: parsed.confidence ?? 0,
      });
      toast.success(t('transactions:scan.success'));
    } catch {
      setScanFailed(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmTransaction = () => {
    if (!extractedData) return;

    createTransactionMutation.mutate(extractedData);
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        {/* Mobile back link — on desktop the top bar carries the breadcrumb */}
        <div className="md:hidden flex items-center mb-4">
          <Link
            href="/transactions"
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-2" />
            {t('transactions:scan.back')}
          </Link>
        </div>

        <PageHeader
          title={t('transactions:scan.title')}
          subtitle={t('transactions:scan.subtitle')}
        />

      <div className="card">

        {/* File Upload Area */}
        {!selectedFile && (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center mb-6">
            <div className="space-y-4">
              <div className="flex justify-center space-x-4">
                <CameraIcon className="w-12 h-12 text-gray-500 dark:text-gray-400" />
                <PhotoIcon className="w-12 h-12 text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  {t('transactions:scan.uploadTitle')}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  {t('transactions:scan.uploadHint')}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={handleCameraCapture}
                  leftIcon={<CameraIcon className="w-5 h-5" />}
                >
                  {t('transactions:scan.takePhoto')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleFileUpload}
                  leftIcon={<PhotoIcon className="w-5 h-5" />}
                >
                  {t('transactions:scan.uploadImage')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden file input for camera */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
        />

        {/* Image Preview */}
        {selectedFile && previewUrl && (
          <div className="mb-6">
            <div className="relative">
              <Image
                src={previewUrl}
                alt={t('transactions:scan.previewAlt')}
                width={0}
                height={0}
                unoptimized
                className="w-full max-h-96 object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                style={{ width: '100%', height: 'auto' }}
              />
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setExtractedData(null);
                }}
                aria-label={t('transactions:scan.removeImage')}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors"
              >
                ×
              </button>
            </div>

            {!extractedData && !isProcessing && (
              <div className="mt-4 text-center">
                <Button
                  onClick={handleProcessReceipt}
                  className="w-full sm:w-auto"
                >
                  {t('transactions:scan.process')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Processing State */}
        {isProcessing && (
          <div className="text-center py-8">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">{t('transactions:scan.processing')}</p>
            <p className="text-sm text-gray-500 dark:text-gray-500">{t('transactions:scan.processingHint')}</p>
          </div>
        )}

        {/* Reading failed — say so plainly and keep the user moving. */}
        {scanFailed && !isProcessing && (
          <div className="p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700 rounded-lg">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-warning-700 dark:text-warning-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-warning-900 dark:text-warning-200">
                  {t('transactions:scan.failedTitle')}
                </p>
                <p className="mt-1 text-sm text-warning-800 dark:text-warning-300">
                  {t('transactions:scan.failedBody')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => router.push('/transactions/add')}>
                    {t('transactions:scan.enterManually')}
                  </Button>
                  <Button variant="secondary" onClick={() => setScanFailed(false)}>
                    {t('transactions:scan.tryAnother')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Extracted Data Review */}
        {extractedData && !isProcessing && (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center">
                <CheckCircleIcon className="w-6 h-6 text-green-700 dark:text-green-400 mr-3" />
                <div>
                  <p className="font-medium text-green-900 dark:text-green-200">{t('transactions:scan.success')}</p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('transactions:scan.confidence', { value: (extractedData.confidence * 100).toFixed(0) })}
                  </p>
                </div>
              </div>
            </div>

            {extractedData.confidence < 0.8 && (
              <div className="flex items-center p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <ExclamationTriangleIcon className="w-6 h-6 text-yellow-700 dark:text-yellow-400 mr-3" />
                <div>
                  <p className="font-medium text-yellow-900 dark:text-yellow-200">{t('transactions:scan.verifyTitle')}</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    {t('transactions:scan.verifyBody')}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label={t('transactions:scan.merchant')}
                value={extractedData.merchant}
                onChange={(e) => setExtractedData({
                  ...extractedData,
                  merchant: e.target.value,
                })}
              />

              <Input
                label={t('transactions:scan.amountWithCurrency', { currency: 'TWD' })}
                type="number"
                inputMode="decimal"
                onWheel={(e) => e.currentTarget.blur()}
                step="0.01"
                value={extractedData.amount}
                onChange={(e) => setExtractedData({
                  ...extractedData,
                  amount: parseFloat(e.target.value),
                })}
              />

              <Input
                label={t('transactions:fields.date')}
                type="date"
                value={extractedData.date}
                onChange={(e) => setExtractedData({
                  ...extractedData,
                  date: e.target.value,
                })}
              />

              <Input
                label={t('transactions:fields.paymentMethod')}
                value={extractedData.paymentMethod || ''}
                onChange={(e) => setExtractedData({
                  ...extractedData,
                  paymentMethod: e.target.value,
                })}
              />
            </div>

            {/* Itemized List */}
            {extractedData.items && extractedData.items.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{t('transactions:scan.items')}</h3>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                  <div className="space-y-2">
                    {extractedData.items.map((item, index) => (
                      <div key={index} className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">
                          {item.quantity}x {item.name}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(item.price, 'TWD', { precision: 0 })}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                      <div className="flex justify-between font-semibold">
                        <span>{t('transactions:scan.total')}</span>
                        <span>{formatCurrency(extractedData.amount, 'TWD', { precision: 0 })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setExtractedData(null);
                }}
                className="sm:w-auto"
              >
                {t('transactions:scan.scanAnother')}
              </Button>
              <Button
                onClick={handleConfirmTransaction}
                isLoading={createTransactionMutation.isPending}
                className="sm:flex-1"
              >
                {t('transactions:scan.addTransaction')}
              </Button>
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-2">{t('transactions:scan.tipsTitle')}</h4>
          <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <li>• {t('transactions:scan.tipLighting')}</li>
            <li>• {t('transactions:scan.tipFlat')}</li>
            <li>• {t('transactions:scan.tipPrinted')}</li>
            <li>• {t('transactions:scan.tipLanguages')}</li>
          </ul>
        </div>
      </div>
      </div>
    </DashboardLayout>
  );
}