'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useIsDark } from '@/contexts/ThemeContext';
import { formatCurrency } from '@/utils/formatters';
import type { SavingRecord } from '@/shared/types';

const money = (v: number) => formatCurrency(v, 'TWD', { precision: 0 });
const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}K` : String(v));

// The goal card's own pair: you in the primary blue, the partner in prosperity green.
const COLORS = { light: { mine: '#0ea5e9', theirs: '#10b981' }, dark: { mine: '#38bdf8', theirs: '#34d399' } };

export interface HistoryPoint {
  date: string;
  mine: number;
  theirs: number;
}

/** Running totals per person, one point per day that had a record, oldest first. */
export function goalHistory(records: SavingRecord[], isMine: (r: SavingRecord) => boolean): HistoryPoint[] {
  const byDay = new Map<string, { mine: number; theirs: number }>();
  for (const r of [...records].sort((a, b) => a.record_date.localeCompare(b.record_date))) {
    const day = byDay.get(r.record_date) ?? { mine: 0, theirs: 0 };
    if (isMine(r)) day.mine += r.amount; else day.theirs += r.amount;
    byDay.set(r.record_date, day);
  }
  let mine = 0;
  let theirs = 0;
  return [...byDay].map(([date, d]) => {
    mine += d.mine;
    theirs += d.theirs;
    return { date, mine, theirs };
  });
}

interface GoalHistoryChartProps {
  records: SavingRecord[];
  isMine: (r: SavingRecord) => boolean;
  target: number;
  partnerName: string;
}

/** How the goal filled up: each person's running total, stacked, against the target. */
export default function GoalHistoryChart({ records, isMine, target, partnerName }: GoalHistoryChartProps) {
  const { t, i18n } = useTranslation('common');
  const isDark = useIsDark();
  const colors = isDark ? COLORS.dark : COLORS.light;
  // On a time axis: points spaced by the days between them, not evenly.
  const data = useMemo(
    () => goalHistory(records, isMine).map((p) => ({ ...p, t: Date.parse(`${p.date}T00:00:00Z`) })),
    [records, isMine],
  );
  if (data.length < 2) return null;

  const youLabel = t('savings.card.you', 'You');
  const axis = isDark ? '#9ca3af' : '#4b5563';
  const grid = isDark ? '#374151' : '#e5e7eb';
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(i18n?.language || 'en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const last = data[data.length - 1];

  return (
    <figure className="mb-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{t('savings.records.history', 'How it filled up')}</span>
        <span className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors.mine }} aria-hidden="true" />{youLabel}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors.theirs }} aria-hidden="true" />{partnerName}</span>
        </span>
      </figcaption>
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={day}
              tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tickFormatter={compact} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={40}
              domain={[0, (max: number) => Math.max(max, target)]} />
            <Tooltip
              formatter={(v: number, key: string) => [money(v), key === 'mine' ? youLabel : partnerName]}
              labelFormatter={(l: number) => day(l)}
              contentStyle={{ background: isDark ? '#1f2937' : '#fff', border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12 }}
            />
            {target > 0 && <ReferenceLine y={target} stroke={axis} strokeDasharray="4 4" />}
            <Area type="stepAfter" dataKey="mine" stackId="1" stroke={colors.mine} fill={colors.mine} fillOpacity={0.35} />
            <Area type="stepAfter" dataKey="theirs" stackId="1" stroke={colors.theirs} fill={colors.theirs} fillOpacity={0.35} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* The chart is decoration for sighted readers; this is the same story in words. */}
      <p className="sr-only">
        {t('savings.records.historySummary', 'Saved so far: you {{mine}}, {{name}} {{theirs}}, of {{target}}.', {
          mine: money(last.mine), theirs: money(last.theirs), name: partnerName, target: money(target),
        })}
      </p>
    </figure>
  );
}
