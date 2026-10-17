'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHANGELOG, CURRENT_VERSION, type ChangelogEntry } from '@/data/changelog';

const STORAGE_KEY = 'aspiro-whatsnew-seen';

interface WhatsNewState {
    /** True once localStorage has been read (avoids SSR/first-paint flash). */
    ready: boolean;
    /** There is a release the user hasn't acknowledged yet. */
    hasUnseen: boolean;
    /** Entries the user hasn't seen (latest only on a first-ever visit). */
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
    // undefined = not read yet (SSR / pre-mount); null = read, nothing stored.
    const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        try {
            setLastSeen(localStorage.getItem(STORAGE_KEY));
        } catch {
            setLastSeen(null);
        }
    }, []);

    const ready = lastSeen !== undefined;

    const unseenEntries = useMemo(() => {
        if (!ready) return [];
        if (!lastSeen) return CHANGELOG.slice(0, 1); // first-ever visit: just the latest
        return CHANGELOG.filter((e) => e.version > lastSeen);
    }, [ready, lastSeen]);

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
