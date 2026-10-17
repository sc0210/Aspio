'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media-query hook. Returns `null` until mounted (so the server and the
 * first client render agree — no hydration mismatch), then the live match state.
 * Callers should treat `null` as "not yet known" and render a neutral state.
 */
function useMediaQuery(query: string): boolean | null {
    const [matches, setMatches] = useState<boolean | null>(null);

    useEffect(() => {
        const mql = window.matchMedia(query);
        setMatches(mql.matches);
        const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}

/** True below Tailwind's `md` breakpoint (< 768px) — i.e. phone territory. */
export function useIsMobile(): boolean | null {
    return useMediaQuery('(max-width: 767px)');
}
