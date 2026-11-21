'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { MARKET_COLORS_KEY, legacyRedUp } from '@/lib/marketColors';

/**
 * Which colour a market rise wears. Western markets draw gains green; Taiwan and
 * most of Asia draw them red (漲紅跌綠). One preference for every surface that
 * shows a market move (holdings, gains, day change, the heatmaps), so the
 * portfolio page cannot say red-up while the dashboard heatmap says green-up.
 *
 * Only market direction follows it. Income and expense, saved and spent, keep
 * their fixed colours: a salary is not a stock going up.
 *
 * Kept per device in localStorage, like the theme.
 */
const KEY = MARKET_COLORS_KEY;

const listeners = new Set<() => void>();

// A failed write must still flip the UI, so the snapshot is held in memory and
// only seeded from storage.
let current: boolean | null = null;
const snapshot = () => (current ??= readRedUp());

function readRedUp(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored === 'red-up';
    const legacy = legacyRedUp((key) => localStorage.getItem(key));
    if (legacy === null) return false;
    // Saved once, so the choice stops being re-derived from the old keys.
    localStorage.setItem(KEY, legacy ? 'red-up' : 'green-up');
    return legacy;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing it.
  const onStorage = (e: StorageEvent) => {
    // null: another tab cleared storage.
    if (e.key === KEY || e.key === null) { current = null; listener(); }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setMarketRedUp(redUp: boolean) {
  try {
    localStorage.setItem(KEY, redUp ? 'red-up' : 'green-up');
  } catch { /* private mode: still applies for this page's life via listeners */ }
  current = redUp;
  listeners.forEach((l) => l());
}

/** The `rise-*` / `fall-*` Tailwind colours swap on this attribute (globals-hybrid.css). */
function applyAttribute(redUp: boolean) {
  if (redUp) document.documentElement.dataset.market = 'red-up';
  else delete document.documentElement.dataset.market;
}

/** Mounted once, in Providers: keeps <html data-market> in step with the preference. */
export function useMarketColorsAttribute() {
  const redUp = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => applyAttribute(redUp), [redUp]);
}

/**
 * For colours that cannot be a class (chart fills, hex scales). Anything styled
 * with classes uses `rise-*` / `fall-*` instead and needs no hook.
 */
export function useMarketColors() {
  const redUp = useSyncExternalStore(subscribe, snapshot, () => false);
  return useMemo(() => {
    /** Whether a move in this direction is drawn green. */
    const green = (up: boolean) => up !== redUp;
    return {
      redUp,
      setRedUp: setMarketRedUp,
      green,
      /** Picks between a green and a red variant of anything (classes, hex). */
      pick: <T>(up: boolean, greenValue: T, redValue: T): T => (green(up) ? greenValue : redValue),
    };
  }, [redUp]);
}

/** For tests: forget the in-memory value so the next read comes from storage. */
export function __resetMarketColorsForTests() {
  current = null;
}
