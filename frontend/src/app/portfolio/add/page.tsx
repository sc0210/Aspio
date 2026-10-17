'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { portfolioService, HoldingInput } from '@/services/portfolioService';
import symbolService, { SymbolQuote, PopularSymbol } from '@/services/symbolService';
import { useAppMode } from '@/hooks/useAppMode';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';

import { log } from '@/utils/logger';
import { localDateString } from '@/utils/formatters';
import { businessToday } from '@/lib/portfolio/businessDate';
import {
  ArrowLeftIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useTranslation } from 'react-i18next';

// Declared, not inferred: the real schema is built inside the component so its
// messages can come from `t`.
type FormData = {
  symbol: string;
  name: string;
  // Mirrors what yup infers: oneOf() over a string schema widens to string,
  // so the narrowing happens at the HoldingInput boundary below — the same way
  // walletType was already handled.
  type: string;
  walletType: 'portfolio' | 'emergency';
  quantity: number;
  averageCost: number;
  currency: string;
  exchange: string;
  sector?: string;
  // A Date once yup has cast it on submit. While editing, the date input holds
  // a YYYY-MM-DD string (see the default below).
  purchaseDate: Date;
};

/** Local end of a YYYY-MM-DD day — the latest instant yup's cast of that day can be. */
function endOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

const INVESTMENT_TYPES = ['stock', 'etf', 'crypto', 'cryptocurrency', 'bond', 'mutual_fund', 'reit', 'commodity', 'cash', 'lending'] as const;

const investmentTypes = [
  { value: 'stock', label: 'Stock', description: 'Individual company shares' },
  { value: 'etf', label: 'ETF', description: 'Exchange-traded funds' },
  { value: 'crypto', label: 'Cryptocurrency', description: 'Digital assets' },
  { value: 'bond', label: 'Bond', description: 'Government or corporate bonds' },
  { value: 'mutual_fund', label: 'Mutual Fund', description: 'Managed investment funds' },
  { value: 'reit', label: 'REIT', description: 'Real Estate Investment Trust' },
  { value: 'commodity', label: 'Commodity', description: 'Raw materials and commodities' },
  { value: 'cash', label: 'Cash/Savings', description: 'Cash holdings and savings accounts' },
];

const currencies = [
  { value: 'TWD', label: 'TWD - Taiwan Dollar' },
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'HKD', label: 'HKD - Hong Kong Dollar' },
  { value: 'MYR', label: 'MYR - Malaysian Ringgit' },
  { value: 'THB', label: 'THB - Thai Baht' },
  { value: 'CNY', label: 'CNY - Chinese Yuan' },
];

const exchanges = [
  { value: 'TWSE', label: 'Taiwan Stock Exchange (TWSE)' },
  { value: 'SGX', label: 'Singapore Exchange (SGX)' },
  { value: 'NYSE', label: 'New York Stock Exchange (NYSE)' },
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'LSE', label: 'London Stock Exchange (LSE)' },
  { value: 'HKEX', label: 'Hong Kong Exchange (HKEX)' },
  { value: 'TSE', label: 'Tokyo Stock Exchange (TSE)' },
  { value: 'KLSE', label: 'Bursa Malaysia (KLSE)' },
  { value: 'SET', label: 'Stock Exchange of Thailand (SET)' },
];

const sectors = [
  'Technology',
  'Financial Services',
  'Healthcare',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
  'Cryptocurrency',
];


export default function AddInvestmentPage() {
  const router = useRouter();
  const { t } = useTranslation(['portfolio']);

  // Rebuilt when the language changes so validation messages follow the UI.
  const schema = useMemo(
    () =>
      yup.object({
        symbol: yup
          .string()
          .required(t('portfolio:addHolding.validation.symbolRequired'))
          .min(1, t('portfolio:addHolding.validation.symbolMin'))
          .max(20, t('portfolio:addHolding.validation.symbolMax'))
          .matches(/^[A-Za-z0-9.-]+$/, t('portfolio:addHolding.validation.symbolChars')),
        name: yup
          .string()
          .required(t('portfolio:addHolding.validation.nameRequired'))
          .min(1, t('portfolio:addHolding.validation.nameRequired'))
          .max(200, t('portfolio:addHolding.validation.nameMax')),
        type: yup
          .string()
          .oneOf(INVESTMENT_TYPES as unknown as string[], t('portfolio:addHolding.validation.typeInvalid'))
          .required(t('portfolio:addHolding.validation.typeRequired')),
        walletType: yup
          .string()
          .oneOf(['portfolio', 'emergency'], t('portfolio:addHolding.validation.walletInvalid'))
          .required(t('portfolio:addHolding.validation.walletRequired')),
        quantity: yup
          .number()
          // An empty number input casts to NaN, which trips yup's typeError before
          // .required() and prints its internal cast message verbatim. Normalise the
          // empty case to undefined so the translated required message shows instead.
          .transform((value, original) =>
            original === '' || original === null ? undefined : value,
          )
          .typeError(t('portfolio:addHolding.validation.quantityRequired'))
          .positive(t('portfolio:addHolding.validation.quantityPositive'))
          .max(999999999, t('portfolio:addHolding.validation.quantityTooLarge'))
          .required(t('portfolio:addHolding.validation.quantityRequired')),
        averageCost: yup
          .number()
          // An empty number input casts to NaN, which trips yup's typeError before
          // .required() and prints its internal cast message verbatim. Normalise the
          // empty case to undefined so the translated required message shows instead.
          .transform((value, original) =>
            original === '' || original === null ? undefined : value,
          )
          .typeError(t('portfolio:addHolding.validation.costRequired'))
          .positive(t('portfolio:addHolding.validation.costPositive'))
          .max(999999999, t('portfolio:addHolding.validation.costTooLarge'))
          .required(t('portfolio:addHolding.validation.costRequired')),
        currency: yup
          .string()
          .required(t('portfolio:addHolding.validation.currencyRequired'))
          .length(3, t('portfolio:addHolding.validation.currencyLength'))
          .matches(/^[A-Z]+$/, t('portfolio:addHolding.validation.currencyUpper')),
        exchange: yup
          .string()
          .required(t('portfolio:addHolding.validation.exchangeRequired'))
          .min(1, t('portfolio:addHolding.validation.exchangeRequired'))
          .max(10, t('portfolio:addHolding.validation.exchangeMax')),
        sector: yup.string().max(50, t('portfolio:addHolding.validation.sectorMax')).optional(),
        purchaseDate: yup
          .date()
          // yup reads a date-only string as local midnight, so bound it by the end
          // of the business day (Asia/Taipei) the input defaults to and allows.
          .max(endOfDay(businessToday()), t('portfolio:addHolding.validation.dateFuture'))
          .required(t('portfolio:addHolding.validation.dateRequired')),
      }),
    [t],
  );
  const { isDemo } = useAppMode();
  const { handleApiError } = useApiErrorHandler();
  const queryClient = useQueryClient();
  const [isNavigating, setIsNavigating] = useState(false);

  // New state for real-time symbol lookup
  const [selectedQuote, setSelectedQuote] = useState<SymbolQuote | null>(null);
  const [popularSymbols, setPopularSymbols] = useState<PopularSymbol[]>([]);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [walletType, setWalletType] = useState<'portfolio' | 'emergency'>('portfolio');

  // Wallet type options for portfolio holdings
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
    formState: { errors },
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      currency: 'TWD',
      exchange: 'TWSE',
      type: 'stock',
      walletType: 'portfolio',
      // A string, not a Date: a native date input bound through register() can
      // only display YYYY-MM-DD, so a Date default rendered blank while still
      // passing the required check and saving today.
      // The resolver's types only know the cast (Date) shape, hence the cast.
      purchaseDate: businessToday() as unknown as Date,
    },
  });

  const addInvestmentMutation = useMutation({
    mutationFn: async (data: FormData) => {
      log.debug('Add holding mutation started', data, 'AddHoldingPage');

      if (isDemo) {
        // Simulate success in demo mode — no API call
        return { id: `demo-${Date.now()}`, symbol: data.symbol } as { id: string; symbol: string };
      }

      const holdingInput: HoldingInput = {
        symbol: data.symbol,
        name: data.name,
        type: data.type as HoldingInput['type'],
        walletType: walletType as 'portfolio' | 'emergency',
        quantity: data.quantity,
        averageCost: data.averageCost,
        currency: data.currency,
        exchange: data.exchange,
        sector: data.sector,
        // yup cast the YYYY-MM-DD input to local midnight; toISOString would send the
        // previous UTC day east of UTC. Send the picked calendar day, as BuyHoldingModal does.
        purchaseDate: data.purchaseDate ? localDateString(new Date(data.purchaseDate)) : undefined,
      };

      log.debug('Calling portfolioService.addHolding', holdingInput, 'AddHoldingPage');
      const response = await portfolioService.addHolding(holdingInput);
      log.debug('Portfolio service response received', response, 'AddHoldingPage');
      return response.data;
    },
    onSuccess: async (data) => {
      log.info('Investment added successfully', { holdingId: data?.id, symbol: data?.symbol }, 'AddHoldingPage');

      const successMessage = isDemo
        ? 'Demo investment added! Sign in to save your real portfolio.'
        : 'Investment added successfully!';
      toast.success(successMessage);

      // Set navigating state to hide current page
      setIsNavigating(true);

      // ⚡ PERFORMANCE: Optimized query invalidation strategy
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-analytics'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-daily-performance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cash-wallet'] });

      // Force refetch to ensure data is fresh before navigation
      await queryClient.refetchQueries({ queryKey: ['portfolio'], type: 'active' });

      // Small delay to ensure query invalidation completes before navigation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navigate using replace to ensure clean transition and prevent back button issues
      log.debug('Navigating to portfolio page', undefined, 'AddHoldingPage');
      router.replace('/portfolio');
    },
    onError: (error) => {
      log.error('Failed to add investment', error, 'AddHoldingPage');
      handleApiError(error, 'Investment creation');
    },
  });

  // Load popular symbols on mount
  useEffect(() => {
    symbolService.getPopularSymbols()
      .then(symbols => {
        setPopularSymbols(symbols);
        log.debug('Popular symbols loaded', { count: symbols.length }, 'AddHoldingPage');
      })
      .catch(err => {
        log.error('Failed to load popular symbols', err, 'AddHoldingPage');
      });
  }, []);

  // Auto-refresh price when market is open; pauses when tab is hidden
  useEffect(() => {
    if (!selectedQuote?.market_open) return;

    const symbol = watch('symbol');
    if (!symbol) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startInterval = () => {
      if (document.visibilityState === 'hidden') return;
      intervalId = setInterval(() => {
        log.debug('Auto-refreshing price', { symbol, market: selectedQuote.market }, 'AddHoldingPage');
        symbolService.getQuote(symbol)
          .then(quote => {
            setSelectedQuote(quote);
            if (quote.status === 'success' && quote.current_price) {
              setValue('averageCost', quote.current_price);
            }
          })
          .catch(err => log.error('Failed to auto-refresh price', err, 'AddHoldingPage'));
      }, 60_000);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
      } else {
        startInterval();
      }
    };

    startInterval();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  // watch captured once at setup — intentionally excluded from deps to avoid re-registering interval on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote?.market_open, selectedQuote?.market, setValue]);

  // Symbol lookup function with auto-fill
  const handleSymbolLookup = async (symbol: string) => {
    if (!symbol || symbol.length < 1) {
      setSelectedQuote(null);
      return;
    }

    setIsLoadingQuote(true);
    const loadingToast = toast.loading(`Looking up ${symbol}...`);

    try {
      if (!isDemo) {
        // Check if this symbol exists in user's portfolio (auth mode only)
        const portfolioResponse = await portfolioService.getPortfolio();
        const existingHolding = portfolioResponse.data?.holdings.find(
          h => h.symbol.toUpperCase() === symbol.toUpperCase()
        );

        if (existingHolding) {
          // Auto-fill from existing holding
          setValue('name', existingHolding.name);
          setValue('exchange', existingHolding.exchange);
          setValue('currency', existingHolding.currency);
          setValue('type', existingHolding.type as FormData['type']);
          if (existingHolding.sector) {
            setValue('sector', existingHolding.sector);
          }
          toast.success(`Found existing ${symbol} in portfolio. Name auto-filled.`, { id: loadingToast });
          setIsLoadingQuote(false);
          return;
        }
      }

      // If not in portfolio, fetch from market data
      const quote = await symbolService.getQuote(symbol);
      setSelectedQuote(quote);

      if (quote.status === 'success' && quote.current_price) {
        // Auto-fill form fields
        setValue('exchange', quote.exchange);
        setValue('currency', quote.currency);
        setValue('averageCost', quote.current_price);

        if (quote.name) {
          setValue('name', quote.name);
        }

        toast.success(`Found ${symbol}: ${quote.currency} ${quote.current_price.toFixed(2)}`, { id: loadingToast });
      } else {
        toast.error(`Could not find price for ${symbol}. Please enter manually.`, { id: loadingToast });
      }
    } catch (error: unknown) {
      log.error('Symbol lookup failed:', error, 'AddHoldingPage');
      setSelectedQuote(null);
      const message = error instanceof Error ? error.message : '';
      if (message.includes('timeout')) {
        toast.error(`Lookup timed out for ${symbol}. You can still add it manually.`, { id: loadingToast });
      } else {
        toast.error(`Failed to fetch price for ${symbol}. You can still add it manually.`, { id: loadingToast });
      }
    } finally {
      setIsLoadingQuote(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!isDemo) {
      // Check if symbol already exists in portfolio (auth mode only)
      const existingResponse = await portfolioService.getPortfolio();
      const existingHolding = existingResponse.data?.holdings.find(
        h => h.symbol.toUpperCase() === data.symbol.toUpperCase()
      );

      if (existingHolding) {
        const newQty = Number(data.quantity);
        const newCost = Number(data.averageCost);
        const oldQty = Number(existingHolding.quantity);
        const oldCost = Number(existingHolding.averageCost);
        const totalQty = oldQty + newQty;
        const weightedAvg = ((oldQty * oldCost) + (newQty * newCost)) / totalQty;
        toast.loading(
          `Adding to existing ${data.symbol}: ${oldQty.toLocaleString()} + ${newQty.toLocaleString()} = ${totalQty.toLocaleString()} shares @ $${weightedAvg.toFixed(2)} avg`,
          { id: 'aggregate-preview', duration: 3000 }
        );
      }
    }

    addInvestmentMutation.mutate(data);
  };


  // Show loading overlay when navigating away
  if (isNavigating) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">{t('portfolio:addHolding.navigating')}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header - Compact */}
        <div className="flex items-center justify-between mb-5">
          <Link
            href="/portfolio"
            className="flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            {t('portfolio:addHolding.back')}
          </Link>

          {/* Mode Indicator */}
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${isDemo
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
            : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
            }`}>
            {isDemo ? 'Demo Mode' : 'Live'}
          </span>
        </div>

        <div className="card">
          <div className="flex items-center mb-4">
            <div className="p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg mr-3">
              <ChartBarIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="flex-1">
              <h1 className="md:hidden text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{t('portfolio:addHolding.title')}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {isDemo ? 'Demo data only' : 'Add to your portfolio'}
              </p>
            </div>
          </div>

          {/* Required Fields Notice */}
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-medium text-sm">
                ⚠️ Fields marked with <span className="text-error-500">*</span> {t('portfolio:addHolding.areRequired')}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Required Fields Section */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-primary-200 dark:border-primary-800">
              <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-300 mb-3 flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 bg-primary-600 text-white rounded-full text-xs">1</span>
                {t('portfolio:addHolding.requiredSection')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Symbol Input with Lookup */}
                <div className="md:col-span-2">
                  <label htmlFor="symbol" className="label font-semibold">
                    {t('portfolio:fields.symbol')} <span className="text-error-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        id="symbol"
                        {...register('symbol')}
                        placeholder={t('portfolio:addHolding.symbolPlaceholder')}
                        error={errors.symbol?.message}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const symbol = (e.target as HTMLInputElement).value;
                            if (symbol) handleSymbolLookup(symbol);
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const symbol = watch('symbol');
                        if (symbol) handleSymbolLookup(symbol);
                      }}
                      disabled={isLoadingQuote || !watch('symbol')}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
                    >
                      {isLoadingQuote ? 'Loading...' : 'Lookup'}
                    </button>
                  </div>

                  {/* Current Price Display - Compact */}
                  {selectedQuote && selectedQuote.status === 'success' && selectedQuote.current_price && (
                    <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-700 dark:text-green-300 font-medium">
                          ✓ {selectedQuote.currency} {selectedQuote.current_price.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleSymbolLookup(watch('symbol'))}
                          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                        >
                          {t('portfolio:refresh')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:col-span-2">
                  <Input
                    {...register('name')}
                    label={<span className="font-semibold">{t('portfolio:addHolding.investmentName')} <span className="text-error-500">*</span></span>}
                    placeholder={t('portfolio:addHolding.namePlaceholder')}
                    error={errors.name?.message}
                  />
                </div>

                <div>
                  <label htmlFor="type" className="label font-semibold">
                    {t('portfolio:fields.type')} <span className="text-error-500">*</span>
                  </label>
                  <select
                    id="type"
                    aria-invalid={!!errors.type}
                    aria-describedby={errors.type ? "type-error" : undefined}
                    {...register('type')}
                    className="input text-sm"
                  >
                    {investmentTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  {errors.type && (
                    <p id="type-error" role="alert" className="mt-1 text-sm text-error-600">{errors.type.message}</p>
                  )}
                </div>

                {/* Wallet Type Selector */}
                <div className="md:col-span-2">
                  <label className="label font-semibold mb-3 block">
                    {t('portfolio:holdingWallet.title')} <span className="text-error-500">*</span>
                  </label>
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
                    <p className="mt-2 text-sm text-error-600">{errors.walletType.message}</p>
                  )}
                </div>

                <div>
                  <Input
                    {...register('purchaseDate')}
                    type="date"
                    label={<span className="font-semibold">{t('portfolio:addHolding.purchaseDate')} <span className="text-error-500">*</span></span>}
                    error={errors.purchaseDate?.message}
                    max={businessToday()}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('portfolio:addHolding.purchaseDateHint')}
                  </p>
                </div>

                <div>
                  <Input
                    {...register('quantity')}
                    type="number"
                    inputMode="decimal"
                    onWheel={(e) => e.currentTarget.blur()}
                    step="0.001"
                    label={<span className="font-semibold">{t('portfolio:fields.quantity')} <span className="text-error-500">*</span></span>}
                    placeholder={t('portfolio:addHolding.quantityPlaceholder')}
                    error={errors.quantity?.message}
                  />
                </div>

                <div>
                  <Input
                    {...register('averageCost')}
                    type="number"
                    inputMode="decimal"
                    onWheel={(e) => e.currentTarget.blur()}
                    step="0.01"
                    label={<span className="font-semibold">{t('portfolio:addHolding.purchasePrice')} <span className="text-error-500">*</span></span>}
                    placeholder={t('portfolio:addHolding.pricePlaceholder')}
                    error={errors.averageCost?.message}
                    leftIcon={<CurrencyDollarIcon className="w-5 h-5 text-gray-400" />}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('portfolio:addHolding.purchasePriceHint')}
                  </p>
                </div>

                <div>
                  <label htmlFor="currency" className="label font-semibold">
                    {t('portfolio:fields.currency')} <span className="text-error-500">*</span>
                  </label>
                  <select
                    id="currency"
                    aria-invalid={!!errors.currency}
                    aria-describedby={errors.currency ? "currency-error" : undefined}
                    {...register('currency')}
                    className="input text-sm"
                  >
                    {currencies.map((currency) => (
                      <option key={currency.value} value={currency.value}>
                        {currency.value}
                      </option>
                    ))}
                  </select>
                  {errors.currency && (
                    <p id="currency-error" role="alert" className="mt-1 text-sm text-error-600">{errors.currency.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="exchange" className="label font-semibold">
                    {t('portfolio:fields.exchange')} <span className="text-error-500">*</span>
                  </label>
                  <select
                    id="exchange"
                    aria-invalid={!!errors.exchange}
                    aria-describedby={errors.exchange ? "exchange-error" : undefined}
                    {...register('exchange')}
                    className="input text-sm"
                  >
                    {exchanges.map((exchange) => (
                      <option key={exchange.value} value={exchange.value}>
                        {exchange.value}
                      </option>
                    ))}
                  </select>
                  {errors.exchange && (
                    <p id="exchange-error" role="alert" className="mt-1 text-sm text-error-600">{errors.exchange.message}</p>
                  )}
                </div>

                {/* Investment Summary - Compact */}
                {watch('quantity') && watch('averageCost') && (
                  <div className="md:col-span-2 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-700">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{t('portfolio:addHolding.totalInvestment')}</span>
                      <span className="text-lg font-bold text-primary-700 dark:text-primary-300">
                        {watch('currency')} {(
                          parseFloat(String(watch('quantity') || 0)) *
                          parseFloat(String(watch('averageCost') || 0))
                        ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Optional Fields Section */}
            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 bg-gray-400 text-white rounded-full text-xs">2</span>
                {t('portfolio:addHolding.optionalSection')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sector" className="label">
                    {t('portfolio:editModal.sector')}
                  </label>
                  <select id="sector" {...register('sector')} className="input text-sm">
                    <option value="">{t('portfolio:addHolding.selectSector')}</option>
                    {sectors.map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    💡 Tip: Use the Lookup button to auto-fill exchange, currency, and current price
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
                className="sm:w-32"
              >
                {t('portfolio:addHolding.cancel')}
              </Button>
              <Button
                type="submit"
                isLoading={addInvestmentMutation.isPending}
                className="sm:flex-1 text-base font-semibold"
              >
                {addInvestmentMutation.isPending ? 'Adding...' : '+ Add to Portfolio'}
              </Button>
            </div>
          </form>
        </div>

        {/* Popular Symbols Section - More Compact */}
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            ⭐ Quick Add - Popular Symbols
          </h3>
          {popularSymbols && popularSymbols.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {popularSymbols.map((investment) => (
                <button
                  key={investment.symbol}
                  type="button"
                  onClick={() => {
                    setValue('symbol', investment.symbol);
                    setValue('name', investment.name);
                    setValue('type', investment.type as FormData['type']);
                    handleSymbolLookup(investment.symbol);
                  }}
                  className="p-2 text-left border border-gray-200 dark:border-gray-700 rounded hover:border-primary-400 dark:hover:border-primary-500 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{investment.symbol}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{investment.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    {investment.type.toUpperCase()}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
              <p>{t('portfolio:addHolding.loading')}</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}