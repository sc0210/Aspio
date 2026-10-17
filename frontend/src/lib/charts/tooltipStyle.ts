import type { CSSProperties } from 'react';

/**
 * Theme-aware styles for a Recharts default `<Tooltip>`.
 *
 * Spread it into the tooltip: `<Tooltip {...chartTooltipStyle(isDark)} />`.
 *
 * All three styles matter. Recharts colours each row from `itemStyle` (falling
 * back to the slice colour, or black when a `<Cell>` set the fill), not from
 * `contentStyle.color`, so a dark box with only `contentStyle.color` set still
 * renders black rows — invisible in dark mode. A transparent background is the
 * other way it goes wrong: /transactions used `var(--tooltip-bg)`, which was
 * never defined anywhere. The wrapper is lifted above any centre label.
 */
export function chartTooltipStyle(isDark: boolean): {
    contentStyle: CSSProperties;
    itemStyle: CSSProperties;
    labelStyle: CSSProperties;
    wrapperStyle: CSSProperties;
} {
    const text = isDark ? '#f3f4f6' : '#111827'; // gray-100 / gray-900
    return {
        contentStyle: {
            backgroundColor: isDark ? 'rgba(31, 41, 55, 0.97)' : 'rgba(255, 255, 255, 0.97)', // gray-800 / white
            border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.6)' : 'rgba(209, 213, 219, 0.8)'}`,
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            fontSize: '12px',
            color: text,
        },
        itemStyle: { color: text },
        labelStyle: { color: isDark ? '#9ca3af' : '#6b7280' }, // gray-400 / gray-500
        // Donuts draw their centre label (total spend…) after the chart, so
        // without this the tooltip slides underneath it.
        wrapperStyle: { zIndex: 20, outline: 'none' },
    };
}
