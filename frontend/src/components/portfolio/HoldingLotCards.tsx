'use client';

import { useTranslation } from 'react-i18next';
import type { PortfolioHolding } from '@/shared/types';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';

const toneOf = (up: boolean) => (up ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400');
const signOf = (up: boolean) => (up ? '+' : '');

interface HoldingLotCardsProps {
    lots: PortfolioHolding[];
    /** The lots aggregated; its figures make the Total card. */
    holding: PortfolioHolding | null;
    currency: string;
    isValueVisible: boolean;
}

/**
 * A holding's purchase lots on a phone: one card per lot, since the desktop table's
 * six columns do not fit 390px, and the table's Total footer as a last card when
 * there is more than one lot.
 */
export function HoldingLotCards({ lots, holding, currency, isValueVisible }: HoldingLotCardsProps) {
    const { t } = useTranslation(['portfolio']);
    // The total's own sign: the chart's period return, used before, is the last
    // close against cost, which can disagree with the live gain near break-even
    // and printed a loss as "+-NT$50" in green.
    const isTotalUp = (holding?.gainLoss ?? 0) >= 0;

    return (
        <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700/50">
            {lots.map((lot, idx) => {
                const lotGain = lot.gainLoss ?? (lot.totalValue - lot.totalCost);
                const lotGainPct = lot.gainLossPercentage;
                const isLotUp = lotGain >= 0;
                return (
                    <li key={lot.id ?? idx} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {lot.purchaseDate
                                    ? new Date(lot.purchaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                                    : '—'}
                            </span>
                            <span className={cn('text-sm font-bold tabular-nums', toneOf(isLotUp))}>
                                {isValueVisible ? `${signOf(isLotUp)}${formatCurrency(lotGain, currency)}` : '•••••'}
                                {isValueVisible && lotGainPct != null && (
                                    <span className="ml-1 text-xs font-semibold">({signOf(isLotUp)}{lotGainPct.toFixed(2)}%)</span>
                                )}
                            </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            {isValueVisible
                                ? `${(lot.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })} × ${formatCurrency(lot.averageCost, currency)} → ${formatCurrency(lot.totalValue, currency)}`
                                : '•••••'}
                        </p>
                    </li>
                );
            })}
            {/* The desktop table's footer, which only renders inside the sm+ table */}
            {lots.length > 1 && holding && (
                <li data-testid="lot-total" className="px-4 py-3 bg-gray-50 dark:bg-gray-700/30">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{t('portfolio:holdingDetail.total')}</span>
                        <span className={cn('text-sm font-bold tabular-nums', toneOf(isTotalUp))}>
                            {isValueVisible ? `${signOf(isTotalUp)}${formatCurrency(holding.gainLoss, currency)}` : '•••••'}
                            {isValueVisible && (
                                <span className="ml-1 text-xs font-semibold">({signOf(isTotalUp)}{(holding.gainLossPercentage ?? 0).toFixed(2)}%)</span>
                            )}
                        </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                        {isValueVisible
                            ? `${(holding.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })} × ${formatCurrency(holding.averageCost, currency)} → ${formatCurrency(holding.totalValue, currency)}`
                            : '•••••'}
                    </p>
                </li>
            )}
        </ul>
    );
}
