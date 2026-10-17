import { chartTooltipStyle } from '@/lib/charts/tooltipStyle';

/** Relative luminance difference is enough here: dark text on light, light on dark. */
const isLight = (hex: string) => parseInt(hex.slice(1, 3), 16) > 128;

it.each([true, false])('dark=%s: rows get an explicit colour that contrasts with the box', (dark) => {
  const s = chartTooltipStyle(dark);
  // Recharts colours rows from itemStyle; without it a <Cell> pie's rows render black.
  expect(s.itemStyle.color).toBeDefined();
  expect(s.itemStyle.color).toBe(s.contentStyle.color);
  expect(isLight(s.itemStyle.color as string)).toBe(dark);
  // A real background, never a CSS variable that may not exist.
  expect(String(s.contentStyle.backgroundColor)).toMatch(/^rgba\(/);
});
