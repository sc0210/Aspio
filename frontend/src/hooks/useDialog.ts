'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useScrollLock } from './useScrollLock';

/**
 * The dialog behaviour `components/ui/Modal` gets for free from Headless UI —
 * Escape to dismiss, a focus trap, focus restored to whatever opened it, and a
 * scroll lock — for the overlays that are hand-rolled instead.
 *
 * Prefer `<Modal>` for anything new. This exists so the existing overlays can be
 * made accessible without rewriting their markup (and their visual design) too.
 *
 * Spread `dialogProps` on the panel element and attach `panelRef` to it:
 *
 *   const { panelRef, dialogProps } = useDialog({ isOpen, onClose });
 *   <div ref={panelRef} {...dialogProps} aria-labelledby={titleId}>
 */

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UseDialogOptions {
    isOpen: boolean;
    onClose: () => void;
    /** Set false for destructive confirmations that must not be dismissed by accident. */
    closeOnEscape?: boolean;
    /**
     * Control to focus on open. Without it focus lands on the first focusable
     * element, which is usually the close button — so a dialog built around one
     * field announces "Close" before the field it exists for. Point this at that
     * field rather than racing the hook with your own focus() call.
     */
    initialFocus?: React.RefObject<HTMLElement | null>;
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({
    isOpen,
    onClose,
    closeOnEscape = true,
    initialFocus,
}: UseDialogOptions) {
    const panelRef = useRef<T | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    // Read the latest onClose from the keydown listener without re-binding it,
    // so an inline arrow passed by the caller does not churn the effect.
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useScrollLock(isOpen);

    const visibleFocusable = useCallback((): HTMLElement[] => {
        const panel = panelRef.current;
        if (!panel) return [];
        return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
            // checkVisibility is the accurate test but is not in every engine (jsdom
            // included); fall back to the explicit-hidden markers rather than to a
            // layout measurement, which reports 0 everywhere outside a real browser.
            if (typeof el.checkVisibility === 'function') return el.checkVisibility();
            return !el.hasAttribute('hidden') && !el.closest('[hidden],[aria-hidden="true"]');
        });
    }, []);

    // Remember the trigger, move focus into the panel, and hand focus back on close.
    useEffect(() => {
        if (!isOpen) return;
        triggerRef.current = document.activeElement as HTMLElement | null;

        // Wait a frame: the panel's children may not be mounted on this tick.
        const raf = requestAnimationFrame(() => {
            const preferred = initialFocus?.current;
            const target = preferred ?? visibleFocusable()[0] ?? panelRef.current;
            target?.focus?.();
        });

        return () => {
            cancelAnimationFrame(raf);
            // Only restore if the trigger is still in the document.
            const trigger = triggerRef.current;
            if (trigger && document.contains(trigger)) trigger.focus();
        };
    }, [isOpen, visibleFocusable, initialFocus]);

    // Escape to dismiss, Tab cycles within the panel.
    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (!closeOnEscape) return;
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;

            const panel = panelRef.current;
            if (!panel) return;
            const items = visibleFocusable();
            if (items.length === 0) {
                event.preventDefault();
                panel.focus();
                return;
            }

            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && (active === first || !panel.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen, closeOnEscape, visibleFocusable]);

    return {
        panelRef,
        dialogProps: {
            role: 'dialog' as const,
            'aria-modal': true,
            tabIndex: -1,
        },
    };
}
