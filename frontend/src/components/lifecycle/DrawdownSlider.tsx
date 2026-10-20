'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { scenarioAt, type StressResult } from '@/lib/lifecycle';

/** The slider's reach. Past 80% the table's "wiped out" already says it all. */
const MAX_DROP = 80;
/** A 0% fall says nothing, and would read "−0%". */
const MIN_DROP = 1;
/** Native range thumb width — the thumb's centre travels inset by half of it. */
const THUMB_PX = 16;

/**
 * Real drawdowns to anchor the slider — peak-to-trough on the S&P 500, the
 * market most of a TW lifecycle portfolio (VT/VOO/0050-style) tracks.
 */
const PRESETS = [
    { key: 'correction', labelKey: 'lifecycle.safety.preset.correction', drop: 20, label: 'Correction' },
    { key: 'covid', labelKey: 'lifecycle.safety.preset.covid', drop: 34, label: '2020 crash' },
    // Closing-price peak to trough, Oct 2007 → Mar 2009.
    { key: 'gfc', labelKey: 'lifecycle.safety.preset.gfc', drop: 57, label: '2008 crisis' },
] as const;

/** Where the thumb's centre sits at `drop`, so the tick lines up with it. */
function tickLeft(drop: number): string {
    const frac = (drop - MIN_DROP) / (MAX_DROP - MIN_DROP);
    return `calc(${frac * 100}% + ${(0.5 - frac) * THUMB_PX}px - 1px)`;
}

interface Props {
    stress: StressResult;
}

/**
 * "What if the market falls X%?" — the drawdown table above it, at any depth.
 *
 * Uses `scenarioAt`, the same arithmetic as the fixed rows, so a slider set to
 * 30% reads exactly what the −30% row does. The wipeout point (1 ÷ leverage) is
 * marked on the track: dragging past it is what the page is warning about.
 */
export function DrawdownSlider({ stress }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const id = useId();
    const [drop, setDrop] = useState(30);

    // Nothing invested, or already underwater: there is no position to stress.
    if (stress.exposure <= 0 || !(stress.net > 0)) return null;

    const s = scenarioAt(stress.exposure, stress.net, drop);
    const wipe = stress.wipeoutDropPct;
    const money = (v: number) => (isValueVisible ? formatTWDCompact(v) : '•••');
    const left = Math.max(0, 100 - s.ownMoneyLossPct);

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 mb-3">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-xs font-medium text-gray-700 dark:text-gray-200">
                    {t('lifecycle.safety.sliderLabel', 'If the market falls')}
                </label>
                <span className="text-sm font-bold tabular-nums text-error-700 dark:text-error-400">−{drop}%</span>
            </div>

            <div className="relative mt-2">
                <input id={id} type="range" min={MIN_DROP} max={MAX_DROP} step={1} value={drop}
                    onChange={(e) => setDrop(Number(e.target.value))}
                    aria-valuetext={`−${drop}%`}
                    className="w-full h-11 sm:h-6 cursor-pointer accent-error-500" />
                {wipe !== null && wipe >= MIN_DROP && wipe <= MAX_DROP && (
                    <span aria-hidden="true" title={t('lifecycle.safety.wipeoutMark', 'Your money hits zero')}
                        className="pointer-events-none absolute -top-1 h-5 w-0.5 bg-error-500"
                        style={{ left: tickLeft(wipe) }} />
                )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                    <button key={p.key} type="button" onClick={() => setDrop(p.drop)}
                        aria-pressed={drop === p.drop}
                        className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-400',
                            drop === p.drop
                                ? 'border-error-300 bg-error-50 text-error-700 dark:border-error-700 dark:bg-error-900/30 dark:text-error-300'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
                        )}>
                        {t(p.labelKey, p.label)} −{p.drop}%
                    </button>
                ))}
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">{t('lifecycle.safety.colYours', 'Your money left')}</dt>
                    <dd className={cn('text-sm font-bold tabular-nums', s.wipedOut ? 'text-error-700 dark:text-error-400' : 'text-gray-900 dark:text-white')}>
                        {s.wipedOut ? t('lifecycle.safety.wipedOut', 'wiped out') : money(s.netAfter)}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">{t('lifecycle.safety.colLoss', 'You lose')}</dt>
                    <dd className="text-sm font-bold tabular-nums text-error-700 dark:text-error-400">−{Math.min(100, s.ownMoneyLossPct).toFixed(0)}%</dd>
                </div>
                <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">{t('lifecycle.safety.colLev', 'Leverage after')}</dt>
                    <dd className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                        {s.leverageAfter === null ? '—' : `${s.leverageAfter.toFixed(2)}×`}
                    </dd>
                </div>
            </dl>

            {/* The bar is your own money: what's left of it, against a market that fell less. */}
            <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden" role="img"
                aria-label={t('lifecycle.safety.sliderBar', '{{left}}% of your own money left', { left: left.toFixed(0) })}>
                <div className={cn('h-full rounded-full', s.wipedOut ? 'bg-error-500' : left < 50 ? 'bg-warning-500' : 'bg-prosperity-500')}
                    style={{ width: `${left}%` }} />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                {stress.leverage > 1
                    ? t('lifecycle.safety.sliderAmplified', 'At {{lev}}× a {{drop}}% fall costs you {{loss}}% of your own money — the loan does not fall with the market.', {
                        lev: stress.leverage.toFixed(2), drop, loss: Math.min(100, s.ownMoneyLossPct).toFixed(0),
                    })
                    : t('lifecycle.safety.sliderUnlevered', 'Unlevered, a fall costs your own money no more than the market fell.')}
            </p>
        </div>
    );
}
