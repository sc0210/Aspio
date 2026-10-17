'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Desktop dashboard view preference: a focused "compact" glance view vs the
 * "full" power dashboard. Persisted in localStorage and synced across every
 * instance (page + toggle) via a custom event, so flipping the toggle re-renders
 * the page immediately. Returns `null` until resolved on the client (avoids a
 * flash of the wrong view). First-ever visit defaults to `full` — no surprise
 * for existing users; their choice is remembered thereafter.
 */

export type DashboardViewMode = 'compact' | 'full';

const KEY = 'aspiro-dashboard-view';
const EVENT = 'aspiro-dashboard-view-changed';

function read(): DashboardViewMode {
    try {
        return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'full';
    } catch {
        return 'full';
    }
}

export function useDashboardViewMode(): [DashboardViewMode | null, (m: DashboardViewMode) => void] {
    const [mode, setModeState] = useState<DashboardViewMode | null>(null);

    useEffect(() => {
        setModeState(read());
        const sync = () => setModeState(read());
        window.addEventListener(EVENT, sync);
        window.addEventListener('storage', sync); // other tabs
        return () => {
            window.removeEventListener(EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    const setMode = useCallback((m: DashboardViewMode) => {
        try {
            localStorage.setItem(KEY, m);
        } catch {
            /* private mode — non-fatal */
        }
        setModeState(m);
        window.dispatchEvent(new Event(EVENT));
    }, []);

    return [mode, setMode];
}
