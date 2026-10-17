'use client';

import { useEffect } from 'react';

/**
 * Freezes the page behind an overlay while `locked` is true.
 *
 * `document.body` never scrolls in this app: `DashboardLayout` renders a
 * `h-[100dvh]` shell and `<main id="main-content">` carries the `overflow-y-auto`.
 * So the conventional `body.style.overflow = 'hidden'` is a no-op here — and so is
 * Headless UI's built-in lock, which targets the document element. Lock the real
 * scroller as well as the body, the latter covering pages rendered outside the
 * dashboard shell (auth, landing, LIFF).
 *
 * Locks are reference-counted: a dialog opened on top of another must not unlock
 * the page when only the inner one closes.
 */

let lockCount = 0;
const restore: Array<[HTMLElement, string]> = [];

function targets(): HTMLElement[] {
    const main = document.getElementById('main-content');
    return main ? [main, document.body] : [document.body];
}

function acquire() {
    if (lockCount === 0) {
        for (const el of targets()) {
            restore.push([el, el.style.overflow]);
            el.style.overflow = 'hidden';
        }
    }
    lockCount += 1;
}

function release() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
        for (const [el, prev] of restore) el.style.overflow = prev;
        restore.length = 0;
    }
}

export function useScrollLock(locked: boolean): void {
    useEffect(() => {
        if (!locked) return;
        acquire();
        return release;
    }, [locked]);
}
