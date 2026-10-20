'use client';

import { useTranslation } from 'react-i18next';
import { ScaleIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { LifecyclePhase, Position, TargetPosition, Tracking, TrackingVerdict } from '@/lib/lifecycle';
import { Card } from '@/components/ui/Card';


interface Props {
    position: Position;
    target: TargetPosition;
    tracking: Tracking;
    maxLeverage: number;
}

const VERDICT_STYLES: Record<TrackingVerdict, { text: string; chip: string }> = {
    'on-track': {
        text: 'text-prosperity-700 dark:text-prosperity-400',
        chip: 'bg-prosperity-100 dark:bg-prosperity-900/40 text-prosperity-700 dark:text-prosperity-300',
    },
    under: {
        text: 'text-primary-700 dark:text-primary-400',
        chip: 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300',
    },
    over: {
        text: 'text-warning-700 dark:text-warning-400',
        chip: 'bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300',
    },
    breach: {
        text: 'text-error-700 dark:text-error-400',
        chip: 'bg-error-100 dark:bg-error-900/40 text-error-700 dark:text-error-300',
    },
};

/**
 * The headline: leverage today against the leverage the strategy asks for, on a
 * scale that ends at the hard ceiling. Everything else on the page explains or
 * stress-tests this one number.
 */
export function PositionHeader({ position, target, tracking, maxLeverage }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();

    const v = VERDICT_STYLES[tracking.verdict];
    const leverageLabel = `${position.leverage.toFixed(2)}×`;

    // The bar runs 0 → ceiling. A breach pins at full width and turns red, which
    // reads more honestly than a bar silently overflowing its track.
    const pct = position.isUnderwater ? 100 : Math.min(100, (position.leverage / maxLeverage) * 100);
    const targetPct = Math.min(100, (target.targetLeverage / maxLeverage) * 100);

    const phaseLabel = (phase: LifecyclePhase) => ({
        accumulate: t('lifecycle.phase.accumulate', 'Phase 1 · Accumulate'),
        deleverage: t('lifecycle.phase.deleverage', 'Phase 2 · Deleveraging'),
        glide: t('lifecycle.phase.glide', 'Phase 3 · Glide down'),
        underwater: t('lifecycle.phase.underwater', 'Underwater'),
    }[phase]);

    const phaseHint = (phase: LifecyclePhase) => ({
        accumulate: t('lifecycle.phase.accumulateHint', 'Your future savings still dwarf your portfolio, so the target exposure is capped by the leverage ceiling rather than by your own money.'),
        deleverage: t('lifecycle.phase.deleverageHint', 'Savings have grown enough that the target leverage now falls every year on its own. No market call required.'),
        glide: t('lifecycle.phase.glideHint', 'Leverage is done. From here the strategy gradually lowers your equity share as retirement approaches.'),
        underwater: t('lifecycle.phase.underwaterHint', 'Investment debt exceeds everything you own. Reduce the debt before adding any exposure.'),
    }[phase]);

    // "Above/Below target" rather than "over/under-levered": the verdict compares
    // exposure to target, which is meaningful even at zero debt, where calling a
    // 0.8× position "over-levered" would be plainly wrong.
    const verdictLabel = {
        'on-track': t('lifecycle.verdict.onTrack', 'On plan'),
        under: t('lifecycle.verdict.under', 'Below target'),
        over: t('lifecycle.verdict.over', 'Above target'),
        breach: t('lifecycle.verdict.breach', 'Ceiling breached'),
    }[tracking.verdict];

    return (
        <Card padding="none" clip>
            <div className="h-px bg-gradient-to-r from-indigo-400/60 via-primary-400/60 to-prosperity-400/60" />
            <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Leverage today */}
                    <div className="lg:col-span-2">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
                            <ScaleIcon className="w-4 h-4 text-indigo-500" />
                            {t('lifecycle.position.title', 'Leverage today')}
                        </h3>

                        <div className="flex items-end gap-3 mb-1">
                            {/* Underwater has no ratio to show, and an em-dash at 48px
                                just reads as a long coloured bar — say it in words. */}
                            <span
                                className={cn(
                                    'font-bold tabular-nums',
                                    v.text,
                                    position.isUnderwater ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-5xl',
                                )}
                            >
                                {position.isUnderwater
                                    ? t('lifecycle.position.undefinedRatio', 'no ratio')
                                    : leverageLabel}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 pb-2">
                                {t('lifecycle.position.target', 'target {{n}}×', { n: target.targetLeverage.toFixed(2) })}
                            </span>
                            <span className={cn('ml-auto rounded-full px-2.5 py-1 text-sm font-bold', v.chip)}>
                                {verdictLabel}
                            </span>
                        </div>

                        {/* Scale: 0 → ceiling, with the target marked. */}
                        <div className="mt-3">
                            <div
                                className="relative h-3 rounded-full bg-gray-200/70 dark:bg-gray-700/70 overflow-hidden"
                                role="progressbar"
                                aria-valuenow={Number.isFinite(position.leverage) ? Number(position.leverage.toFixed(2)) : maxLeverage}
                                aria-valuemin={0}
                                aria-valuemax={maxLeverage}
                                aria-label={t('lifecycle.position.title', 'Leverage today')}
                            >
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all',
                                        tracking.overCeiling ? 'bg-error-500' : tracking.verdict === 'over' ? 'bg-warning-500' : 'bg-indigo-500',
                                    )}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            {/* Target marker sits outside the clipped track so it stays visible. */}
                            <div className="relative h-4">
                                <div
                                    className="absolute -top-3.5 w-0.5 h-5 bg-gray-800 dark:bg-white/80 rounded"
                                    style={{ left: `calc(${targetPct}% - 1px)` }}
                                    aria-hidden="true"
                                />
                            </div>
                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 -mt-1">
                                <span>0×</span>
                                <span>1× · {t('lifecycle.position.noDebt', 'no debt')}</span>
                                <span>{maxLeverage}× · {t('lifecycle.position.ceiling', 'ceiling')}</span>
                            </div>
                        </div>

                        {/* What to do about the gap. */}
                        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            {tracking.verdict === 'breach'
                                ? t('lifecycle.position.gapBreach', 'Leverage is above the {{max}}× ceiling. Reduce debt or exposure before anything else on this page matters.', { max: maxLeverage })
                                : Math.abs(tracking.exposureGap) < 1
                                    ? t('lifecycle.position.gapNone', 'Exposure matches the target.')
                                    : tracking.exposureGap > 0
                                        ? t('lifecycle.position.gapUnder', 'Room for {{amount}} more exposure before you hit the target.', {
                                            amount: isValueVisible ? formatTWDCompact(tracking.exposureGap) : '•••',
                                        })
                                        : t('lifecycle.position.gapOver', '{{amount}} above target — let savings catch up rather than adding more.', {
                                            amount: isValueVisible ? formatTWDCompact(Math.abs(tracking.exposureGap)) : '•••',
                                        })}
                        </p>
                    </div>

                    {/* Phase + the three numbers behind the ratio */}
                    <div className="lg:col-span-1 flex flex-col gap-3">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                            <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{phaseLabel(target.phase)}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                {phaseHint(target.phase)}
                            </p>
                        </div>

                        <dl className="grid grid-cols-3 lg:grid-cols-1 gap-2">
                            <Stat
                                label={t('lifecycle.position.exposure', 'Stock exposure')}
                                value={isValueVisible ? formatTWDCompact(position.stockExposure) : '•••'}
                            />
                            <Stat
                                label={t('lifecycle.position.debt', 'Investment debt')}
                                value={isValueVisible ? formatTWDCompact(position.investmentDebt) : '•••'}
                                tone="debt"
                            />
                            <Stat
                                label={t('lifecycle.position.ownMoney', 'Your own money')}
                                value={isValueVisible ? formatTWDCompact(position.netFinancialAssets) : '•••'}
                                tone={position.isUnderwater ? 'debt' : 'good'}
                            />
                        </dl>
                    </div>
                </div>
            </div>
        </Card>
    );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'debt' }) {
    return (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-0.5">
            <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
            <dd
                className={cn(
                    'text-xs font-bold tabular-nums',
                    tone === 'good' && 'text-prosperity-700 dark:text-prosperity-400',
                    tone === 'debt' && 'text-error-700 dark:text-error-400',
                    tone === 'neutral' && 'text-gray-800 dark:text-gray-100',
                )}
            >
                {value}
            </dd>
        </div>
    );
}
