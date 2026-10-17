import React, { useId, useState, useRef } from 'react';
import { cn } from '@/utils/cn';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';

/**
 * SimpleSparkline Component
 *
 * A lightweight inline chart component for displaying quick data trends
 * in dashboard cards without heavy dependencies.
 *
 * Features:
 * - Smooth cubic Bezier curve line (no jagged polyline)
 * - Gradient area fill under the line
 * - Terminal dot indicator at the current value
 * - Custom hex color prop (falls back to trend-based color)
 * - Accessible SVG output
 */

interface SimpleSparklineProps {
    /** Array of numeric values to plot */
    data: number[];
    /** Optional date/label strings for each data point — shown in hover tooltip */
    labels?: string[];
    /** Height of the chart in pixels */
    height?: number;
    /** Color theme fallback when no explicit color is provided */
    trend?: 'up' | 'down' | 'neutral';
    /** Explicit hex/rgb color — overrides trend colors */
    color?: string;
    /** Whether to show the terminal dot */
    showDot?: boolean;
    /** Custom className */
    animated?: boolean;
    className?: string;
}

/** Converts an array of {x,y} points into a smooth cubic Bezier SVG path string */
function smoothLinePath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        // Mid-point control points produce a clean smooth S-curve
        const midX = (prev.x + curr.x) / 2;
        d += ` C ${midX} ${prev.y} ${midX} ${curr.y} ${curr.x} ${curr.y}`;
    }
    return d;
}

/** Closes the smooth line into a filled area path (adds bottom-left and bottom-right anchors) */
function smoothAreaPath(pts: { x: number; y: number }[], bottom: number): string {
    if (pts.length < 2) return '';
    const line = smoothLinePath(pts);
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${line} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
}

export const SimpleSparkline = React.memo(({
    data,
    labels,
    height = 40,
    trend = 'neutral',
    color,
    showDot = true,
    animated = true,
    className,
}: SimpleSparklineProps) => {
    // Stable gradient ID — required so multiple sparklines on a page don't share one <defs>
    const uid = useId().replace(/:/g, '');
    const svgRef = useRef<SVGSVGElement>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    if (!data || data.length < 2) {
        return null;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const W = 100; // viewBox width — responsive via CSS
    const PAD = 3;
    const usableW = W - PAD * 2;
    const usableH = height - PAD * 2;
    const bottom = height - PAD;

    const pts = data.map((v, i) => ({
        x: PAD + (i / (data.length - 1)) * usableW,
        y: PAD + usableH - ((v - min) / range) * usableH,
    }));

    // Resolve stroke color
    const fallbackColors = {
        up: '#10b981', // emerald-500
        down: '#f97316', // orange-500
        neutral: '#6366f1', // indigo-500
    };
    const strokeColor = color || fallbackColors[trend];

    const linePath = smoothLinePath(pts);
    const areaPath = smoothAreaPath(pts, bottom);
    const lastPt = pts[pts.length - 1];
    const gradId = `spark-grad-${uid}`;

    // Mouse handlers — convert clientX → viewBox X → nearest data index
    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const svgX = ((e.clientX - rect.left) / rect.width) * W;
        const raw = (svgX - PAD) / usableW * (data.length - 1);
        setHoveredIndex(Math.max(0, Math.min(data.length - 1, Math.round(raw))));
    };
    const handleMouseLeave = () => setHoveredIndex(null);

    // Hover tooltip geometry
    const hPt = hoveredIndex !== null ? pts[hoveredIndex] : null;
    const hValue = hoveredIndex !== null ? data[hoveredIndex] : null;
    const hLabel = (hoveredIndex !== null && labels) ? labels[hoveredIndex] : null;

    // Format value compactly (e.g. 1,234,567 → 1.2M)
    const formatHoverValue = (v: number) => {
        if (Math.abs(v) >= 1_000_000) {
            return formatCurrencyUtil(v, 'TWD', { compact: true });
        }
        if (Math.abs(v) >= 1_000) {
            return formatCurrencyUtil(v, 'TWD', { precision: 0 });
        }
        return v.toFixed(1);
    };

    // Tooltip box sizing
    const tipText = hValue !== null ? formatHoverValue(hValue) : '';
    const tipW = Math.max(tipText.length * 4.5 + 8, 38);
    const tipH = hLabel ? 18 : 13;
    const tipX = hPt ? Math.min(Math.max(hPt.x - tipW / 2, 1), W - tipW - 1) : 0;
    const tipY = hPt ? Math.max(hPt.y - tipH - 5, 1) : 0;

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${height}`}
            className={cn('overflow-visible cursor-crosshair', className)}
            aria-hidden="true"
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                </linearGradient>
            </defs>

            {/* Gradient area fill */}
            <path
                d={areaPath}
                fill={`url(#${gradId})`}
                stroke="none"
            />

            {/* Smooth line */}
            <path
                d={linePath}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={animated ? { strokeDasharray: 300, strokeDashoffset: 0 } : undefined}
            />

            {/* Terminal dot — current value indicator */}
            {showDot && hoveredIndex === null && (
                <>
                    {/* Glow ring */}
                    <circle cx={lastPt.x} cy={lastPt.y} r="3.5" fill={strokeColor} opacity="0.2" />
                    {/* Solid dot */}
                    <circle cx={lastPt.x} cy={lastPt.y} r="2" fill={strokeColor} />
                </>
            )}

            {/* Hover crosshair + tooltip */}
            {hPt !== null && hValue !== null && (
                <>
                    {/* Vertical crosshair line */}
                    <line
                        x1={hPt.x} y1={PAD}
                        x2={hPt.x} y2={bottom}
                        stroke={strokeColor}
                        strokeWidth="0.8"
                        strokeDasharray="2 2"
                        opacity="0.6"
                    />

                    {/* Hovered point dot */}
                    <circle cx={hPt.x} cy={hPt.y} r="3" fill={strokeColor} opacity="0.25" />
                    <circle cx={hPt.x} cy={hPt.y} r="1.8" fill={strokeColor} />

                    {/* Tooltip bubble */}
                    <rect
                        x={tipX} y={tipY}
                        width={tipW} height={tipH}
                        rx="2" ry="2"
                        fill="rgba(15,23,42,0.85)"
                    />
                    <text
                        x={tipX + tipW / 2} y={tipY + (hLabel ? 7 : 8.5)}
                        textAnchor="middle"
                        fontSize="5.5"
                        fontWeight="700"
                        fill="white"
                        fontFamily="system-ui, sans-serif"
                    >
                        {tipText}
                    </text>
                    {hLabel && (
                        <text
                            x={tipX + tipW / 2} y={tipY + 14}
                            textAnchor="middle"
                            fontSize="4"
                            fill="rgba(148,163,184,0.9)"
                            fontFamily="system-ui, sans-serif"
                        >
                            {hLabel}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
});

SimpleSparkline.displayName = 'SimpleSparkline';

/**
 * MiniPieChart Component
 *
 * A simplified pie/donut chart for showing asset allocation or category breakdown.
 *
 * Features:
 * - Responsive SVG rendering
 * - Animated entrance and interactions
 * - Center label for donut variant
 * - Legend support with click handlers
 */

interface MiniPieChartItem {
    label: string;
    value: number;
    color: string;
}

interface MiniPieChartProps {
    /** Data items to display */
    data: MiniPieChartItem[];
    /** Donut hole radius (0-50, percentage of radius) */
    innerRadius?: number;
    /** Size in pixels */
    size?: number;
    /** Center text for donut variant */
    centerText?: string;
    /** Show legend below chart */
    showLegend?: boolean;
    /** Click handler for legend items */
    onLegendClick?: (label: string) => void;
    /** Custom className */
    className?: string;
}

const MiniPieChart = React.memo(({
    data,
    innerRadius = 0,
    size = 120,
    centerText,
    showLegend = false,
    onLegendClick,
    className,
}: MiniPieChartProps) => {
    if (!data || data.length === 0) {
        return null;
    }

    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return null;

    const radius = size / 2 - 2;
    const centerX = size / 2;
    const centerY = size / 2;

    let currentAngle = -Math.PI / 2;
    const slices = data.map((item, _index) => {
        const sliceAngle = (item.value / total) * Math.PI * 2;
        const startAngle = currentAngle;
        const endAngle = currentAngle + sliceAngle;

        // Calculate start and end points
        const startX = centerX + radius * Math.cos(startAngle);
        const startY = centerY + radius * Math.sin(startAngle);
        const endX = centerX + radius * Math.cos(endAngle);
        const endY = centerY + radius * Math.sin(endAngle);

        // Large arc flag
        const largeArc = sliceAngle > Math.PI ? 1 : 0;

        // Build path
        const innerRadiusValue = (innerRadius / 100) * radius;
        let path = `M ${startX} ${startY}`;
        path += ` A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;

        if (innerRadius > 0) {
            const innerStartX = centerX + innerRadiusValue * Math.cos(startAngle);
            const innerStartY = centerY + innerRadiusValue * Math.sin(startAngle);
            const innerEndX = centerX + innerRadiusValue * Math.cos(endAngle);
            const innerEndY = centerY + innerRadiusValue * Math.sin(endAngle);

            path += ` L ${innerEndX} ${innerEndY}`;
            path += ` A ${innerRadiusValue} ${innerRadiusValue} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`;
            path += ` Z`;
        } else {
            path += ` L ${centerX} ${centerY} Z`;
        }

        currentAngle = endAngle;

        return { path, ...item, percentage: ((item.value / total) * 100).toFixed(1) };
    });

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            <svg
                viewBox={`0 0 ${size} ${size}`}
                className="w-full h-auto"
                aria-label={`Pie chart: ${data.map(d => `${d.label} ${((d.value / total) * 100).toFixed(1)}%`).join(', ')}`}
            >
                {slices.map((slice, index) => (
                    <path
                        key={index}
                        d={slice.path}
                        fill={slice.color}
                        fillOpacity="0.8"
                        className="hover:fill-opacity-100 transition-all duration-200 cursor-pointer"
                        onClick={() => onLegendClick?.(slice.label)}
                    />
                ))}

                {/* Center text for donut */}
                {centerText && innerRadius > 0 && (
                    <text
                        x={centerX}
                        y={centerY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-xs font-semibold fill-gray-900 dark:fill-white"
                    >
                        {centerText}
                    </text>
                )}
            </svg>

            {/* Legend */}
            {showLegend && (
                <div className="flex flex-wrap gap-2">
                    {slices.map((slice, index) => (
                        <button
                            key={index}
                            onClick={() => onLegendClick?.(slice.label)}
                            className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
                            aria-label={`${slice.label}: ${slice.percentage}%`}
                        >
                            <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: slice.color }}
                            />
                            <span className="text-gray-700 dark:text-gray-300 truncate">
                                {slice.label}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});

MiniPieChart.displayName = 'MiniPieChart';

/**
 * MiniBarChart Component
 *
 * A simple horizontal bar chart for showing comparisons.
 */

interface MiniBarChartItem {
    label: string;
    value: number;
    target?: number;
    color?: string;
}

interface MiniBarChartProps {
    /** Data items */
    data: MiniBarChartItem[];
    /** Maximum value for scaling (auto if not provided) */
    maxValue?: number;
    /** Show target/comparison line */
    showTarget?: boolean;
    /** Custom className */
    className?: string;
}

const MiniBarChart = React.memo(({
    data,
    maxValue,
    showTarget = false,
    className,
}: MiniBarChartProps) => {
    if (!data || data.length === 0) return null;

    const max = maxValue || Math.max(...data.map(d => Math.max(d.value, d.target || 0)));

    return (
        <div className={cn('space-y-3', className)}>
            {data.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-16 truncate">
                        {item.label}
                    </span>
                    <div className="flex-1">
                        {/* Bar background */}
                        <div className="relative h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            {/* Value bar */}
                            <div
                                className={cn(
                                    'h-full rounded-full transition-all duration-300',
                                    item.color || 'bg-primary-500',
                                )}
                                style={{ width: `${(item.value / max) * 100}%` }}
                            />

                            {/* Target indicator */}
                            {showTarget && item.target !== undefined && (
                                <div
                                    className="absolute top-0 h-full w-0.5 bg-orange-400 opacity-60"
                                    style={{ left: `${(item.target / max) * 100}%` }}
                                    title={`Target: ${item.target}`}
                                />
                            )}
                        </div>
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-12 text-right">
                        {((item.value / max) * 100).toFixed(0)}%
                    </span>
                </div>
            ))}
        </div>
    );
});

MiniBarChart.displayName = 'MiniBarChart';
