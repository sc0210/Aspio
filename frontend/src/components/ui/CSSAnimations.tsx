'use client';

/**
 * CSS-based animation components to replace framer-motion
 * Saves ~170KB from bundle size while maintaining smooth animations
 */

import { useState, useEffect, ReactNode } from 'react';
import { cn } from '@/utils/cn';

// ============================================
// AnimatePresence replacement using CSS
// ============================================

interface FadeInOutProps {
    show: boolean;
    children: ReactNode;
    duration?: number;
    className?: string;
    onExitComplete?: () => void;
}

export function FadeInOut({
    show,
    children,
    duration = 200,
    className,
    onExitComplete
}: FadeInOutProps) {
    const [shouldRender, setShouldRender] = useState(show);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setShouldRender(true);
            // Small delay to trigger CSS transition
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsVisible(true);
                });
            });
        } else {
            setIsVisible(false);
            const timer = setTimeout(() => {
                setShouldRender(false);
                onExitComplete?.();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [show, duration, onExitComplete]);

    if (!shouldRender) return null;

    return (
        <div
            className={cn(
                'transition-opacity',
                isVisible ? 'opacity-100' : 'opacity-0',
                className
            )}
            style={{ transitionDuration: `${duration}ms` }}
        >
            {children}
        </div>
    );
}

// ============================================
// Scale + Fade animation (for modals, cards)
// ============================================

interface ScaleFadeProps {
    show: boolean;
    children: ReactNode;
    duration?: number;
    className?: string;
}

export function ScaleFade({ show, children, duration = 300, className }: ScaleFadeProps) {
    const [shouldRender, setShouldRender] = useState(show);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setShouldRender(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsVisible(true);
                });
            });
        } else {
            setIsVisible(false);
            const timer = setTimeout(() => setShouldRender(false), duration);
            return () => clearTimeout(timer);
        }
    }, [show, duration]);

    if (!shouldRender) return null;

    return (
        <div
            className={cn(
                'transition-all',
                isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
                className
            )}
            style={{ transitionDuration: `${duration}ms` }}
        >
            {children}
        </div>
    );
}
