/**
 * Where the gains-in-red preference is stored, and how an older choice is read.
 * Plain module (no 'use client'), so the root layout's boot script can share it
 * with hooks/useMarketColors.ts.
 */
export const MARKET_COLORS_KEY = 'aspiro-market-colors';

/**
 * The two toggles this replaced. The dashboard heatmap's outranks the portfolio
 * calendar's: it was the one on the main screen. Only read when the new key is
 * unset; the result is then saved under the new key.
 */
export const LEGACY_HEATMAP_KEY = 'aspiro-heatmap-tw-colors'; // '1' = red-up
export const LEGACY_CALENDAR_KEY = 'cal-tw-mode'; // 'true' = red-up

/** `true`/`false`, or null when nothing was ever chosen. */
export function legacyRedUp(get: (key: string) => string | null): boolean | null {
  const heatmap = get(LEGACY_HEATMAP_KEY);
  if (heatmap !== null) return heatmap === '1';
  const calendar = get(LEGACY_CALENDAR_KEY);
  return calendar !== null ? calendar === 'true' : null;
}

/**
 * Runs in <head> before first paint, so a red-up user never sees gains drawn
 * green for a frame before React's effect sets the attribute.
 */
export const MARKET_COLORS_BOOT_SCRIPT = `try{var s=localStorage,v=s.getItem('${MARKET_COLORS_KEY}'),h=s.getItem('${LEGACY_HEATMAP_KEY}'),c=s.getItem('${LEGACY_CALENDAR_KEY}');var r=v?v==='red-up':h!==null?h==='1':c==='true';if(r)document.documentElement.dataset.market='red-up'}catch(e){}`;
