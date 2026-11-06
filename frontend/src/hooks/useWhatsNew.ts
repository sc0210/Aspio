'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHANGELOG, CURRENT_VERSION, type ChangelogEntry } from '@/data/changelog';

const STORAGE_KEY = 'aspiro-whatsnew-seen';

interface WhatsNewState {
    /** True once localStorage has been read (avoids SSR/first-paint flash). */
    ready: boolean;
    /** There is a release the user hasn't acknowledged yet. */
    hasUnseen: boolean;
    /** Entries the user hasn't seen. A first-ever visit starts as up to date. */
    unseenEntries: ChangelogEntry[];
    /** Full history, newest first. */
    entries: ChangelogEntry[];
    /** Most recent release. */
    latest: ChangelogEntry;
    /** Mark the current version as seen (persists to localStorage). */
    markSeen: () => void;
}

/**
 * Tracks which changelog version the user has acknowledged. Client-only — the
 * "seen" marker lives in localStorage, so no backend is involved. Version keys
 * are date-based (e.g. "2026.07"), which sort lexicographically.
 */
export function useWhatsNew(): WhatsNewState {
    // undefined = not read yet (SSR / pre-mount).
    const [lastSeen, setLastSeen] = useState<string | undefined>(undefined);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setLastSeen(stored);
            } else {
                // First-ever visit: a changelog means nothing to someone who never
                // used the previous version, and it landed on top of a new
                // visitor's first look at the app. Start them as up to date.
                localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
                setLastSeen(CURRENT_VERSION);
            }
        } catch {
            // Storage unavailable: we can't remember a dismissal either, so
            // treat it as seen rather than reopening on every visit.
            setLastSeen(CURRENT_VERSION);
        }
    }, []);

    const ready = lastSeen !== undefined;

    const unseenEntries = useMemo(() => {
        if (lastSeen === undefined) return [];
        return CHANGELOG.filter((e) => e.version > lastSeen);
    }, [lastSeen]);

    const markSeen = useCallback(() => {
        try {
            localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
        } catch {
            /* storage unavailable (private mode) — non-fatal */
        }
        setLastSeen(CURRENT_VERSION);
    }, []);

    return {
        ready,
        hasUnseen: ready && lastSeen !== CURRENT_VERSION,
        unseenEntries,
        entries: CHANGELOG,
        latest: CHANGELOG[0],
        markSeen,
    };
}
