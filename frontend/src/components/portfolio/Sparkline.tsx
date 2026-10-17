'use client';

import { useId, useMemo } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showArea?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 32,
  color,
  showArea = true
}: SparklineProps) {
  // Hooks must run before the isEmpty early return below.
  const uid = useId().replace(/:/g, '');

  const { path, areaPath, isPositive, isEmpty } = useMemo(() => {
    if (!data || data.length === 0) {
      return { path: '', areaPath: '', isPositive: true, isEmpty: true };
    }

    const validData = data.filter(d => typeof d === 'number' && !isNaN(d));
    if (validData.length === 0) {
      return { path: '', areaPath: '', isPositive: true, isEmpty: true };
    }

    // Calculate trend (positive if end > start)
    const isPositive = validData[validData.length - 1] >= validData[0];

    // Find min and max for scaling
    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const range = max - min || 1; // Avoid division by zero

    // Create SVG path
    const padding = 2;
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    const step = chartWidth / (validData.length - 1 || 1);

    const points = validData.map((value, index) => {
      const x = padding + index * step;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return { x, y };
    });

    // Line path
    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(' ');

    // Area path (for gradient fill)
    let fillPath = '';
    if (showArea && points.length > 0) {
      fillPath = linePath +
        ` L ${points[points.length - 1].x.toFixed(1)} ${height}` +
        ` L ${points[0].x.toFixed(1)} ${height} Z`;
    }

    return {
      path: linePath,
      areaPath: fillPath,
      isPositive,
      isEmpty: false
    };
  }, [data, width, height, showArea]);

  if (isEmpty) {
    return (
      <div
        style={{ width: `${width}px`, height: `${height}px` }}
        className="flex items-center justify-center"
      >
        <span className="text-xs text-gray-400">—</span>
      </div>
    );
  }

  const strokeColor = color || (isPositive
    ? 'rgb(34, 197, 94)' // success-500
    : 'rgb(239, 68, 68)' // error-500
  );

  const _fillColor = color || (isPositive
    ? 'rgba(34, 197, 94, 0.2)' // success-500 with opacity
    : 'rgba(239, 68, 68, 0.2)' // error-500 with opacity
  );

  // A fresh id per render would re-point the fill's url(#...) at a def being replaced
  // in the same commit; `uid` is stable across renders and SSR-safe.
  const gradientId = `gradient-${isPositive ? 'success' : 'error'}-${uid}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline transition-all duration-300 hover:scale-105"
      style={{ display: 'block' }}
    >
      <defs>
        {/* Gradient for smoother area fill */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.4" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {showArea && areaPath && (
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
          className="transition-all duration-300"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-300 drop-shadow-sm"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1))' }}
      />
    </svg>
  );
}
