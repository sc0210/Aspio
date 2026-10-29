'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  CurrencyDollarIcon,
  PencilIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { log } from '@/utils/logger';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portfolioService } from '@/services/portfolioService';
import type { PortfolioHolding } from '@/shared/types';
import { useModeAwareUI } from '@/hooks/useAppMode';
import { invalidateDashboardData } from '@/hooks/useDataSynchronization';
import { localDateString } from '@/utils/formatters';
import { INVESTMENT_TYPES, investmentTypes, currencies, exchanges, sectors } from '@/lib/portfolio/holdingFormOptions';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

// Built per-render so the messages follow the UI language, same as
// portfolio/add. The keys live under addHolding.validation because both pages
// show identical copy; worth hoisting to portfolio:validation.* if a third
// caller appears.
const makeSchema = (t: TFunction) =>
  yup.object({
    symbol: yup.string().required(t('portfolio:addHolding.validation.symbolRequired')),
    name: yup.string().required(t('portfolio:addHolding.validation.nameRequired')),
    type: yup
      .string()
      .oneOf([...INVESTMENT_TYPES], t('portfolio:addHolding.validation.typeInvalid'))
      .required(t('portfolio:addHolding.validation.typeRequired')),
    walletType: yup
      .string()
      .oneOf(['portfolio', 'emergency'], t('portfolio:addHolding.validation.walletInvalid'))
      .required(t('portfolio:addHolding.validation.walletRequired')),
    quantity: yup
      .number()
      // An empty number input casts to NaN, which trips typeError before
      // .required() and prints yup's internal cast message verbatim.
      .transform((value, original) => (original === '' || original === null ? undefined : value))
      .typeError(t('portfolio:addHolding.validation.quantityRequired'))
      .positive(t('portfolio:addHolding.validation.quantityPositive'))
      .required(t('portfolio:addHolding.validation.quantityRequired')),
    averageCost: yup
      .number()
      .transform((value, original) => (original === '' || original === null ? undefined : value))
      .typeError(t('portfolio:addHolding.validation.costRequired'))
      .positive(t('portfolio:addHolding.validation.costPositive'))
      .required(t('portfolio:addHolding.validation.costRequired')),
    currency: yup.string().required(t('portfolio:addHolding.validation.currencyRequired')),
    exchange: yup.string().required(t('portfolio:addHolding.validation.exchangeRequired')),
    sector: yup.string(),
    purchaseDate: yup.string(),
  });

type FormData = yup.InferType<ReturnType<typeof makeSchema>>;


export default function EditHoldingPage() {
  const router = useRouter();
  const params = useParams();
  const holdingId = params.id as string;
  const { getModeIndicator, getModeMessage, getErrorMessage, isDemo } = useModeAwareUI();
  const { t } = useTranslation(['portfolio']);
  const schema = useMemo(() => makeSchema(t), [t]);
  const [isLoading, setIsLoading] = useState(true);
  const [holding, setHolding] = useState<PortfolioHolding | null>(null);
  const [walletType, setWalletType] = useState<'portfolio' | 'emergency'>('portfolio');
  const queryClient = useQueryClient();

  // Wallet type options
  const WALLET_TYPES = [
    {
      value: 'portfolio' as const,
      label: t('portfolio:holdingWallet.portfolio.label'),
      description: t('portfolio:holdingWallet.portfolio.description'),
      icon: '📈',
      color: 'from-blue-500 to-indigo-500',
    },
    {
      value: 'emergency' as const,
      label: t('portfolio:holdingWallet.emergency.label'),
      description: t('portfolio:holdingWallet.emergency.description'),
      icon: '🚨',
      color: 'from-amber-500 to-orange-500',
    },
  ];

  const {
    register,
    handleSubmit,
    // dirtyFields, because the purchase date must be sent only when the user
    // actually changed it — see the mutation below.
    formState: { errors, dirtyFields },
    setValue,
    watch,
    reset,
  } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  // Load holding data
  useEffect(() => {
    const loadHolding = async () => {
      try {
        setIsLoading(true);
        const response = await portfolioService.getHolding(holdingId);
        if (response.data) {
          const holdingData = response.data;
          setHolding(holdingData);

          // Set wallet type if it's a known value
          if (holdingData.walletType === 'portfolio' || holdingData.walletType === 'emergency') {
            setWalletType(holdingData.walletType);
          }

          reset({
            symbol: holdingData.symbol,
            name: holdingData.name,
            type: holdingData.type,
            walletType: holdingData.walletType === 'emergency' ? 'emergency' : 'portfolio',
            quantity: holdingData.quantity,
            averageCost: holdingData.averageCost,
            currency: holdingData.currency,
            exchange: holdingData.exchange,
            sector: holdingData.sector || '',
            // Date input wants YYYY-MM-DD, and purchaseDate is a stored instant, so
            // the day has to be read in the viewer's zone as every other surface
            // reads it. Slicing the ISO string takes the UTC day, which is the day
            // before for anything bought after 16:00 UTC in Taipei.
            purchaseDate: holdingData.purchaseDate
              ? localDateString(new Date(holdingData.purchaseDate))
              : '',
          });
        }
      } catch (error) {
        log.error('Failed to load holding:', error);
        toast.error(t('portfolio:toast.holdingLoadFailed'));
        router.push('/portfolio');
      } finally {
        setIsLoading(false);
      }
    };

    // Demo mode resolves the holding from the portfolio list rather than
    // /holdings/{id}: that endpoint answers unauthenticated requests with a
    // generic DEMO stub (symbol "DEMO", qty 10, cost 100), so loading through it
    // would put a phantom record in the form. The list endpoint serves the real
    // demo portfolio, which is where the user clicked Edit from — the same
    // source the holding detail page uses.
    const loadDemoHolding = async () => {
      try {
        setIsLoading(true);
        const res = await portfolioService.getPortfolio();
        if (!res.success) {
          // A failed fetch is not a missing holding. Without this the page falls
          // through to "Holding not found", so a backend blip reads to the user
          // as a bad link.
          throw new Error('Failed to load the demo portfolio');
        }
        const match = (res.data?.holdings ?? []).find((h) => h.id === holdingId);
        if (match) {
          setHolding(match);
          if (match.walletType === 'portfolio' || match.walletType === 'emergency') {
            setWalletType(match.walletType);
          }
          reset({
            symbol: match.symbol,
            name: match.name,
            type: match.type,
            walletType: match.walletType === 'emergency' ? 'emergency' : 'portfolio',
            quantity: match.quantity,
            averageCost: match.averageCost,
            currency: match.currency,
            exchange: match.exchange,
            sector: match.sector || '',
            purchaseDate: match.purchaseDate
              ? localDateString(new Date(match.purchaseDate))
              : '',
          });
        }
      } catch (error) {
        // Mirror the authenticated path: say what happened and leave, rather
        // than dropping the user on "Holding not found", which claims the id
        // was wrong when the load simply failed.
        log.error('Failed to load demo holding:', error);
        toast.error(t('portfolio:toast.holdingLoadFailed'));
        router.push('/portfolio');
      } finally {
        setIsLoading(false);
      }
    };

    if (!holdingId) return;
    if (isDemo) {
      loadDemoHolding();
    } else {
      loadHolding();
    }
  }, [holdingId, isDemo, reset, router, t]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (isDemo) {
        return { success: true, data: null, message: '' };
      }
      const updateData = {
        symbol: data.symbol,
        name: data.name,
        type: data.type,
        wallet_type: walletType,
        quantity: data.quantity,
        averageCost: data.averageCost,
        currency: data.currency,
        exchange: data.exchange,
        sector: data.sector,
        // Persist the edited purchase date so the buy-point markers on the holding
        // detail chart move to the new date — but only when the user actually
        // changed it, not merely because the form prefilled it.
        //
        // The backend re-dates the linked Life Wallet expense to match the purchase
        // date, comparing business days in Asia/Taipei. A date input is read in the
        // viewer's zone. So re-sending an untouched prefill is itself a date change
        // at any other offset, and a save that edited only the name or the sector
        // would move a purchase — and its expense — into the previous month.
        ...(dirtyFields.purchaseDate && data.purchaseDate
          ? { purchaseDate: new Date(data.purchaseDate).toISOString() }
          : {}),
      };

      return portfolioService.updateHolding({
        id: holdingId,
        ...updateData,
      });
    },
    onSuccess: async () => {
      // The registry's groups, not a hand-picked list: a purchase-date edit moves the
      // linked Life Wallet expense, so the transaction list and the /review month
      // reports go stale too, and neither was in the list this replaced.
      //
      // The four keys that used to be invalidated here by hand are all in those
      // groups already — portfolio in dashboardRelated, and portfolio-analytics,
      // portfolio-daily-performance and cash-wallet in ledgerDerived. Keeping them
      // meant invalidating each twice (portfolio three times, with the refetch
      // below), and invalidateQueries defaults to cancelRefetch, so every repeat
      // restarted an in-flight request to those endpoints.
      invalidateDashboardData(queryClient);

      // Bounded on purpose, and it is a trade-off rather than a free win.
      //
      // 'all' is needed because this page mounts no portfolio query — an 'active'
      // filter matched nothing and resolved instantly, which is what let the list
      // render the pre-edit holding. But the ['portfolio', …] prefix also covers the
      // trend page, the holding detail and every cached filter combination, each of
      // which calls getPortfolio. Waiting on all of them means that on a slow Pi the
      // save button spins and the success toast is withheld for up to the 30s client
      // timeout, for a PUT that has already committed.
      //
      // So: wait, but not indefinitely. If the bound wins, the list may paint the old
      // figure for a moment and then flip — the same brief staleness you would get
      // from relying on the invalidation alone, which is what actually guarantees
      // convergence. cancelRefetch: false joins the fetches invalidateDashboardData
      // started rather than restarting them, so this adds no requests either way.
      let bound: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          queryClient.refetchQueries(
            { queryKey: ['portfolio'], type: 'all' },
            { cancelRefetch: false },
          ),
          new Promise((resolve) => {
            bound = setTimeout(resolve, 2000);
          }),
        ]);
      } finally {
        // Otherwise every fast save leaves a 2s timer pending.
        if (bound) clearTimeout(bound);
      }

      // Not getSuccessMessage: its templates say "{{action}} added", which read
      // "Demo Holding updated added!" (and "Holding updated added successfully!").
      toast.success(
        isDemo
          ? t('portfolio:toast.demoHoldingUpdated')
          : t('portfolio:toast.holdingUpdated'),
      );
      router.push('/portfolio');
    },
    onError: (error) => {
      log.error('Update holding error:', error);
      toast.error(getErrorMessage('update holding'));
    },
  });

  const onSubmit = async (data: FormData) => {
    updateMutation.mutate(data);
  };

  const watchedType = watch('type');

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <LoadingSpinner size="lg" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!holding) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Holding not found</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">The holding you&apos;re looking for doesn&apos;t exist.</p>
            <Link href="/portfolio" className="btn-primary">
              Back to Portfolio
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
          <Link
            href="/portfolio"
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors mr-4"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-2" />
            Back to Portfolio
          </Link>
        </div>

        <div className="card">
          <div className="flex items-center mb-6">
            <div className="p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg mr-4">
              <PencilIcon className="w-6 h-6 text-primary-700 dark:text-primary-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="md:hidden text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Edit Holding</h1>
                {/* Mode Indicator */}
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getModeIndicator().className}`}>
                  {getModeIndicator().text}
                </span>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                {getModeMessage('general')}
              </p>
            </div>
          </div>

          {/* Current holding info */}
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Current Holding Information</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Current Price:</span>
                <div className="font-medium text-gray-900 dark:text-gray-100">{holding.currency} {holding.currentPrice?.toLocaleString()}</div>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Total Value:</span>
                <div className="font-medium text-gray-900 dark:text-gray-100">{holding.currency} {holding.totalValue?.toLocaleString()}</div>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Gain/Loss:</span>
                <div className={`font-medium ${holding.gainLoss >= 0 ? 'text-success-700 dark:text-success-400' : 'text-error-700 dark:text-error-400'}`}>
                  {holding.gainLoss >= 0 ? '+' : ''}{holding.currency} {holding.gainLoss?.toLocaleString()}
                  ({holding.gainLossPercentage?.toFixed(2)}%)
                </div>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Last Updated:</span>
                <div className="font-medium text-gray-900 dark:text-gray-100">{new Date(holding.lastUpdated).toLocaleDateString()}</div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Investment Type */}
            <div>
              <span id="page-investment-type" className="label">Investment Type</span>
              <div
                role="radiogroup"
                aria-labelledby="page-investment-type"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              >
                {investmentTypes.map((type) => (
                  <label
                    key={type.value}
                    className={`relative flex cursor-pointer rounded-lg border p-4 transition-all ${watchedType === type.value
                      ? 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    <input
                      {...register('type')}
                      type="radio"
                      value={type.value}
                      className="sr-only"
                    />
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{type.label}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">{type.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Wallet Type Selector */}
            <div>
              <label className="label mb-3 block">{t('portfolio:holdingWallet.title')} <span className="text-error-700 dark:text-error-500">*</span></label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {WALLET_TYPES.map((wallet) => {
                  const isSelected = walletType === wallet.value;
                  return (
                    <button
                      key={wallet.value}
                      type="button"
                      onClick={() => {
                        setWalletType(wallet.value);
                        setValue('walletType', wallet.value);
                      }}
                      className={`relative flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all duration-200 text-left ${isSelected
                        ? `bg-gradient-to-br ${wallet.color} border-transparent shadow-lg scale-[1.02]`
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm'
                        }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-2xl">{wallet.icon}</span>
                        {isSelected && (
                          <CheckCircleIcon className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div>
                        <div className={`text-sm font-bold ${isSelected
                          ? 'text-white'
                          : 'text-gray-700 dark:text-gray-300'
                          }`}>
                          {wallet.label}
                        </div>
                        <div className={`text-xs mt-1 ${isSelected
                          ? 'text-white/90'
                          : 'text-gray-500 dark:text-gray-400'
                          }`}>
                          {wallet.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <input type="hidden" {...register('walletType')} value={walletType} />
              {errors.walletType && (
                <p className="mt-2 text-sm text-error-700 dark:text-error-600">{errors.walletType.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-6">
                <Input
                  {...register('symbol')}
                  label="Symbol"
                  placeholder="e.g., AAPL, STI, BTC"
                  error={errors.symbol?.message}
                  required
                />

                <Input
                  {...register('name')}
                  label="Investment Name"
                  placeholder="e.g., Apple Inc., SPDR STI ETF"
                  error={errors.name?.message}
                  required
                />

                <div>
                  <label htmlFor="currency" className="label">
                    Currency <span className="text-error-700 dark:text-error-500">*</span>
                  </label>
                  <select
                    aria-invalid={!!errors.currency}
                    aria-describedby={errors.currency ? "currency-error" : undefined}
                    id="currency"
                    {...register('currency')}
                    className="input"
                  >
                    {currencies.map((currency) => (
                      <option key={currency.value} value={currency.value}>
                        {currency.label}
                      </option>
                    ))}
                  </select>
                  {errors.currency && (
                    <p id="currency-error" role="alert" className="mt-1 text-sm text-error-700 dark:text-error-600">{errors.currency.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="exchange" className="label">
                    Exchange <span className="text-error-700 dark:text-error-500">*</span>
                  </label>
                  <select
                    aria-invalid={!!errors.exchange}
                    aria-describedby={errors.exchange ? "exchange-error" : undefined}
                    id="exchange"
                    {...register('exchange')}
                    className="input"
                  >
                    {exchanges.map((exchange) => (
                      <option key={exchange.value} value={exchange.value}>
                        {exchange.label}
                      </option>
                    ))}
                  </select>
                  {errors.exchange && (
                    <p id="exchange-error" role="alert" className="mt-1 text-sm text-error-700 dark:text-error-600">{errors.exchange.message}</p>
                  )}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                <Input
                  {...register('quantity')}
                  type="number"
                  inputMode="decimal"
                  onWheel={(e) => e.currentTarget.blur()}
                  step="0.001"
                  label="Quantity"
                  placeholder={t('portfolio:fields.quantityPlaceholder', 'Number of shares/units')}
                  error={errors.quantity?.message}
                  required
                />

                <Input
                  {...register('averageCost')}
                  type="number"
                  inputMode="decimal"
                  onWheel={(e) => e.currentTarget.blur()}
                  step="0.01"
                  label="Average Cost Per Unit"
                  placeholder={t('portfolio:fields.averageCostPlaceholder', 'Cost per share/unit')}
                  error={errors.averageCost?.message}
                  leftIcon={<CurrencyDollarIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
                  required
                />

                <Input
                  {...register('purchaseDate')}
                  type="date"
                  label="Purchase Date"
                  error={errors.purchaseDate?.message}
                />

                <div>
                  <label htmlFor="sector" className="label">
                    Sector (optional)
                  </label>
                  <select
                    id="sector"
                    {...register('sector')}
                    className="input"
                  >
                    <option value="">Select sector</option>
                    {sectors.map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Investment Summary */}
                {watch('quantity') && watch('averageCost') && (
                  <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">Updated Investment Summary</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Quantity:</span>
                        <span className="text-gray-900 dark:text-gray-100">{parseFloat(String(watch('quantity') || 0)).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Avg Cost:</span>
                        <span className="text-gray-900 dark:text-gray-100">{watch('currency')} {parseFloat(String(watch('averageCost') || 0)).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t border-gray-200 dark:border-gray-600 pt-1">
                        <span className="text-gray-900 dark:text-gray-100">Total Cost:</span>
                        <span className="text-gray-900 dark:text-gray-100">
                          {watch('currency')} {(
                            parseFloat(String(watch('quantity') || 0)) *
                            parseFloat(String(watch('averageCost') || 0))
                          ).toFixed(2)}
                        </span>
                      </div>
                      {holding.currentPrice && (
                        <div className="flex justify-between font-semibold">
                          <span className="text-gray-900 dark:text-gray-100">Current Value:</span>
                          <span className="text-gray-900 dark:text-gray-100">
                            {watch('currency')} {(
                              parseFloat(String(watch('quantity') || 0)) *
                              holding.currentPrice
                            ).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
                className="sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={updateMutation.isPending}
                className="sm:flex-1"
              >
                Update Holding
              </Button>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}