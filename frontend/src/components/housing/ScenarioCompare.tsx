'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { formatTWDCompact } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { projectBuyVsRent, type BuyVsRentInputs } from '@/lib/housing/buyVsRent';
import {
    addScenario,
    loadScenarios,
    storeScenarios,
    MAX_NAME,
    MAX_SCENARIOS,
    type SavedScenario,
} from '@/lib/housing/scenarios';

const WAN = 10_000;

interface Props {
    /** What the simulator shows right now. */
    current: BuyVsRentInputs;
    /** Puts a saved scenario's inputs back into the simulator. */
    onLoad: (inputs: BuyVsRentInputs) => void;
}

/**
 * Save the simulator's setup under a name and compare up to three side by
 * side with what's on screen. The comparison runs each through the same
 * projection the chart uses, so a row and the chart can't disagree.
 */
export function ScenarioCompare({ current, onLoad }: Props) {
    const { t } = useTranslation('common');
    const { isValueVisible } = usePrivacy();
    const [saved, setSaved] = useState<SavedScenario[]>([]);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const [unsaved, setUnsaved] = useState(false);

    // After mount: storage read during render would differ from the server pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setSaved(loadScenarios()), []);

    const update = (next: SavedScenario[]) => {
        setSaved(next);
        // Private window or full storage: keep it for this visit, and say so.
        setUnsaved(!storeScenarios(next));
    };

    const save = () => {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        update(addScenario(saved, name, current, id));
        setName('');
        setNaming(false);
    };

    const rows = useMemo(
        () => [
            { id: 'current', name: t('housing.scenarios.current', 'On screen'), inputs: current },
            ...saved,
        ].map((s) => ({ ...s, result: projectBuyVsRent(s.inputs) })),
        [saved, current, t],
    );

    const money = (v: number) => (isValueVisible ? formatTWDCompact(v) : '•••');
    const full = saved.length >= MAX_SCENARIOS;

    return (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('housing.scenarios.title', 'Compare scenarios')}
                </p>
                {naming ? (
                    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
                        <input
                            autoFocus
                            value={name}
                            maxLength={MAX_NAME}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }}
                            placeholder={t('housing.scenarios.namePlaceholder', 'e.g. Banqiao, 20% down')}
                            aria-label={t('housing.scenarios.name', 'Scenario name')}
                            className="w-48 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        />
                        <button type="submit" disabled={!name.trim()}
                            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                            {t('housing.scenarios.save', 'Save')}
                        </button>
                    </form>
                ) : (
                    <button type="button" onClick={() => setNaming(true)} disabled={full}
                        title={full ? t('housing.scenarios.full', 'Up to {{n}} — remove one to save another', { n: MAX_SCENARIOS }) : undefined}
                        className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                        {t('housing.scenarios.saveCurrent', 'Save this setup')}
                    </button>
                )}
            </div>

            {unsaved && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    ⚠ {t('housing.scenarios.notStored', "This browser wouldn't store it, so it will be gone after a reload.")}
                </p>
            )}

            {saved.length === 0 ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {t('housing.scenarios.empty', 'Save a setup to compare it with others — different homes, down payments or rates. Kept in this browser only.')}
                </p>
            ) : (
                <div className="mt-3 overflow-x-auto -mx-1 px-1">
                    <table className="w-full min-w-[560px] text-xs">
                        <thead>
                            <tr className="text-left text-gray-400 dark:text-gray-500">
                                <th className="py-1.5 font-medium">{t('housing.scenarios.colName', 'Scenario')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.sim.housePrice', 'House price')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.sim.downPct', 'Down payment')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.sim.rate', 'Mortgage rate')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.sim.monthlyPay', 'Mortgage / mo')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.scenarios.colVerdict', 'After the stay')}</th>
                                <th className="py-1.5 font-medium text-right">{t('housing.sim.breakEven', 'Break-even')}</th>
                                <th className="py-1.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {rows.map((r) => {
                                const buyWins = r.result.finalAdvantage >= 0;
                                const isCurrent = r.id === 'current';
                                return (
                                    <tr key={r.id} className={cn(isCurrent && 'bg-indigo-50/60 dark:bg-indigo-900/20')}>
                                        <td className="py-2 pr-2 font-medium text-gray-800 dark:text-gray-100 max-w-[10rem] truncate">
                                            {isCurrent ? r.name : (
                                                <button type="button" onClick={() => onLoad(r.inputs)}
                                                    title={t('housing.scenarios.load', 'Load into the simulator')}
                                                    className="text-left underline decoration-dotted underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                                                    {r.name}
                                                </button>
                                            )}
                                        </td>
                                        <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{Math.round(r.inputs.housePrice / WAN).toLocaleString()} {t('housing.unitWan')}</td>
                                        <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.inputs.downPaymentPct}%</td>
                                        <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.inputs.mortgageRatePct}%</td>
                                        <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{money(r.result.monthlyPayment)}</td>
                                        <td className={cn('py-2 text-right tabular-nums font-semibold', buyWins ? 'text-indigo-600 dark:text-indigo-300' : 'text-amber-600 dark:text-amber-400')}>
                                            {buyWins ? t('housing.sim.buy', 'Buy') : t('housing.sim.rent', 'Rent')} +{money(Math.abs(r.result.finalAdvantage))}
                                            <span className="ml-1 font-normal text-gray-400">· {r.inputs.holdingYears}{t('housing.sim.yearShort', 'y')}</span>
                                        </td>
                                        <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                                            {r.result.breakEvenYear === null ? '—' : t('housing.scenarios.yearN', 'Year {{y}}', { y: r.result.breakEvenYear })}
                                        </td>
                                        <td className="py-2 pl-2 text-right">
                                            {!isCurrent && (
                                                <button type="button" onClick={() => update(saved.filter((s) => s.id !== r.id))}
                                                    aria-label={t('housing.scenarios.remove', 'Remove {{name}}', { name: r.name })}
                                                    className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                                                    <XMarkIcon className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
