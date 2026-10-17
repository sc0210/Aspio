'use client';

import { useMemo, useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { formatCurrency, toTWD } from '@/utils/formatters';

// Per-holding metadata keyed by symbol so the treemap tile renderer and tooltip
// can look up colour/percent/value without relying on recharts spreading custom
// fields through its content component.
interface NodeInfo {
  symbol: string;
  name: string;
  sector: string;
  value: number;
  currency: string;
  dayPct: number; // today's change %
  totalPct: number; // total gain/loss %
  primaryPct: number; // the one driving colour + tile label (daily, or total as fallback)
  fill: string;
}

// Diverging scale intensities (weak → strong), matching the dashboard's P&L
// calendar heatmap palette (Tailwind emerald / red, dark-mode shades) so the
// two heatmaps read as one design.
const GREENS = ['#065f46', '#047857', '#059669']; // emerald 800 · 700 · 600
const REDS = ['#991b1b', '#b91c1c', '#dc2626'];   // red 800 · 700 · 600
const NEUTRAL = '#4b5563';                         // gray 600

// Colour a gain/loss %. Western: gains green, losses red. TW/Asian markets use
// the opposite convention (漲紅跌綠 — gains red, losses green), toggled via `tw`.
function heatColor(pct: number, tw: boolean): string {
  const gain = tw ? REDS : GREENS;
  const loss = tw ? GREENS : REDS;
  if (pct >= 3) return gain[2];
  if (pct >= 1.5) return gain[1];
  if (pct >= 0.3) return gain[0];
  if (pct > -0.3) return NEUTRAL; // ~flat
  if (pct > -1.5) return loss[0];
  if (pct > -3) return loss[1];
  return loss[2];
}

// The 7-swatch legend (Loss → Gain), ordered to match the current colour mode.
function legendColors(tw: boolean): string[] {
  const gain = tw ? REDS : GREENS;
  const loss = tw ? GREENS : REDS;
  return [loss[2], loss[1], loss[0], NEUTRAL, gain[0], gain[1], gain[2]];
}

const HEATMAP_TW_KEY = 'aspiro-heatmap-tw-colors';

const formatPct = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

/** Recharts Treemap content: draws sector-block borders (depth 1) and holding
 *  tiles (depth 2). Reads colour/label from the `nodes` lookup by symbol. */
function TreemapTile(props: {
  x?: number; y?: number; width?: number; height?: number;
  depth?: number; name?: string; nodes?: Record<string, NodeInfo>;
}) {
  const { x = 0, y = 0, width = 0, height = 0, depth = 0, name = '', nodes = {} } = props;

  if (depth === 1) {
    // Sector block outline — groups same-sector holdings like the finviz map.
    return (
      <rect
        x={x} y={y} width={width} height={height}
        fill="none" stroke="#0b0f19" strokeWidth={3}
      />
    );
  }
  if (depth !== 2) return null;

  const info = nodes[name];
  const fill = info?.fill ?? '#374151';
  const showSymbol = width > 34 && height > 22;
  const showPct = width > 44 && height > 40;
  const fontSize = Math.max(9, Math.min(15, Math.floor(width / 4.5)));

  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        fill={fill} stroke="#0b0f19" strokeWidth={1}
      />
      {showSymbol && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showPct ? 7 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          stroke="none"
          fontSize={fontSize}
          fontWeight={700}
        >
          {name}
        </text>
      )}
      {showPct && info && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#f8fafc"
          stroke="none"
          fontSize={11}
        >
          {formatPct(info.primaryPct)}
        </text>
      )}
    </g>
  );
}

export function PortfolioHeatmap() {
  const { t } = useTranslation('common');
  const { isValueVisible } = usePrivacy();
  const { holdings, isLoading: loading } = usePortfolio();

  // Colour convention: false = Western (gain green), true = TW/Asian (gain red).
  // Persisted so it sticks across visits.
  const [twMode, setTwMode] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem(HEATMAP_TW_KEY) === '1',
  );
  const toggleTw = () =>
    setTwMode(prev => {
      const next = !prev;
      try { localStorage.setItem(HEATMAP_TW_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });

  const { treeData, nodes, count, anyDaily } = useMemo(() => {
    const active = (holdings || []).filter(h => (h.totalValue ?? 0) > 0);
    const otherLabel = t('portfolio.sectorOther', 'Other');

    // Aggregate multiple lots of the SAME symbol into a single position:
    // sum current value and gain, and derive an aggregate cost (value - gain) so
    // the tile's % is the blended return across all lots of that asset.
    const agg = new Map<
      string,
      { symbol: string; name: string; sector: string; value: number; cost: number; gain: number; dayChange: number }
    >();
    for (const h of active) {
      // Normalize to TWD so US (USD) and TW (TWD) holdings are sized on the same
      // scale — otherwise a USD number (~31× smaller) makes US positions look
      // tiny. FX cancels in the %, so returns are unaffected.
      const cur = h.currency || 'TWD';
      const value = toTWD(Number(h.totalValue) || 0, cur);
      const gain = toTWD(Number(h.gainLoss) || 0, cur);
      const dayChange = toTWD(Number(h.dayChange) || 0, cur);
      const existing = agg.get(h.symbol);
      if (existing) {
        existing.value += value;
        existing.cost += value - gain;
        existing.gain += gain;
        existing.dayChange += dayChange;
        if (existing.sector === otherLabel && h.sector?.trim()) existing.sector = h.sector.trim();
      } else {
        agg.set(h.symbol, {
          symbol: h.symbol,
          name: h.name || h.symbol,
          sector: h.sector?.trim() || otherLabel,
          value,
          cost: value - gain,
          gain,
          dayChange,
        });
      }
    }

    // If no holding has intraday data (e.g. demo, or before a price refresh),
    // fall back to colouring by total gain/loss so the map isn't all-neutral.
    const anyDaily = Array.from(agg.values()).some(e => Math.abs(e.dayChange) > 0.005);

    const nodes: Record<string, NodeInfo> = {};
    const bySector = new Map<string, { name: string; size: number }[]>();
    for (const e of agg.values()) {
      const totalPct = e.cost > 0 ? (e.gain / e.cost) * 100 : 0;
      // Prior-close value = current value − today's change; % vs that base.
      const prevValue = e.value - e.dayChange;
      const dayPct = prevValue > 0 ? (e.dayChange / prevValue) * 100 : 0;
      const primaryPct = anyDaily ? dayPct : totalPct;
      nodes[e.symbol] = {
        symbol: e.symbol,
        name: e.name,
        sector: e.sector,
        value: e.value, // TWD-normalized
        currency: 'TWD',
        dayPct,
        totalPct,
        primaryPct,
        fill: heatColor(primaryPct, twMode),
      };
      if (!bySector.has(e.sector)) bySector.set(e.sector, []);
      bySector.get(e.sector)!.push({ name: e.symbol, size: e.value });
    }

    const treeData = Array.from(bySector.entries())
      .map(([sector, children]) => ({
        name: sector,
        children: children.sort((a, b) => b.size - a.size),
      }))
      .sort(
        (a, b) =>
          b.children.reduce((s, c) => s + c.size, 0) -
          a.children.reduce((s, c) => s + c.size, 0),
      );

    return { treeData, nodes, count: agg.size, anyDaily };
  }, [holdings, t, twMode]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 sm:p-6 h-full">
      <div className="mb-4">
        {/* Title row: heading left, colour legend + toggle on the right — the
            subtitle spans full-width below so a long subtitle can't push the
            legend onto its own line. */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('portfolio.heatmapTitle', 'Portfolio Heatmap')}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
          {/* Diverging colour legend — compact joined strip (reorders with mode) */}
          <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span>{t('portfolio.heatmapLoss', 'Loss')}</span>
            <span className="flex rounded-sm overflow-hidden">
              {legendColors(twMode).map((c, i) => (
                <span key={`${c}-${i}`} className="inline-block w-2.5 h-3" style={{ backgroundColor: c }} />
              ))}
            </span>
            <span>{t('portfolio.heatmapGain', 'Gain')}</span>
          </div>
          {/* Western ↔ TW colour convention toggle */}
          <button
            type="button"
            onClick={toggleTw}
            aria-pressed={twMode}
            title={t('portfolio.heatmapColorToggleHint', 'Switch gain/loss colours (TW markets use red for gains)')}
            className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors"
          >
            {twMode ? t('portfolio.heatmapColorTwShort', '漲紅跌綠') : t('portfolio.heatmapColorUsShort', '漲綠跌紅')}
          </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {anyDaily
            ? t('portfolio.heatmapSubtitle', "Tile size = position weight (TWD) · colour = today's change")
            : t('portfolio.heatmapSubtitleTotal', 'Tile size = position weight (TWD) · colour = total gain/loss')}
        </p>
      </div>

      {loading ? (
        <div className="h-72 sm:h-80 rounded-xl bg-gray-100 dark:bg-gray-700/40 animate-pulse" />
      ) : count === 0 ? (
        <div className="h-72 sm:h-80 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-700/20">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center px-6">
            {t('portfolio.heatmapEmpty', 'No holdings to display yet. Add investments to see your heatmap.')}
          </p>
        </div>
      ) : (
        <div className="h-72 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treeData}
              dataKey="size"
              stroke="#0b0f19"
              isAnimationActive={false}
              content={<TreemapTile nodes={nodes} />}
            >
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const leaf = payload[0]?.payload as { name?: string } | undefined;
                  const info = leaf?.name ? nodes[leaf.name] : undefined;
                  if (!info) return null;
                  return (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 shadow-lg">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">
                        {info.symbol} <span className="font-normal text-gray-500 dark:text-gray-400">· {info.sector}</span>
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{info.name}</p>
                      <div className="mt-1.5 space-y-0.5 text-xs">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500 dark:text-gray-400">{t('portfolio.heatmapValue', 'Value')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">
                            {isValueVisible ? formatCurrency(info.value, info.currency, { compact: info.value >= 100000, precision: 0 }) : '•••'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500 dark:text-gray-400">{t('portfolio.heatmapToday', 'Today')}</span>
                          <span className={info.dayPct >= 0 ? 'text-success-600 dark:text-success-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                            {formatPct(info.dayPct)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-gray-500 dark:text-gray-400">{t('portfolio.heatmapTotal', 'Total')}</span>
                          <span className={info.totalPct >= 0 ? 'text-success-600 dark:text-success-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                            {formatPct(info.totalPct)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
