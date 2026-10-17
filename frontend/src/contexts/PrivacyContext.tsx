'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface PrivacyContextType {
    /** Whether financial values are visible (true) or masked (false) */
    isValueVisible: boolean;
    /** Toggle the visibility of financial values */
    toggleValueVisibility: () => void;
    /** Explicitly set visibility */
    setValueVisible: (visible: boolean) => void;
    /** Mask a string value — returns the original if visible, or masked placeholder if hidden */
    maskValue: (value: string, maskChar?: string) => string;
}

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

const STORAGE_KEY = 'aspiro-privacy-mode';
const DEFAULT_MASK = '•••••';

interface PrivacyProviderProps {
    children: React.ReactNode;
    /** Default visibility state (defaults to true = visible) */
    defaultVisible?: boolean;
}

export function PrivacyProvider({ children, defaultVisible = true }: PrivacyProviderProps) {
    const [isValueVisible, setIsValueVisible] = useState(defaultVisible);
    const [mounted, setMounted] = useState(false);

    // Load saved preference from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved !== null) {
                setIsValueVisible(saved === 'visible');
            }
        } catch {
            // localStorage not available (SSR)
        }
        setMounted(true);
    }, []);

    // Persist preference to localStorage
    useEffect(() => {
        if (!mounted) return;
        try {
            localStorage.setItem(STORAGE_KEY, isValueVisible ? 'visible' : 'hidden');
        } catch {
            // localStorage not available
        }
    }, [isValueVisible, mounted]);

    const toggleValueVisibility = useCallback(() => {
        setIsValueVisible(prev => !prev);
    }, []);

    const setValueVisible = useCallback((visible: boolean) => {
        setIsValueVisible(visible);
    }, []);

    const maskValue = useCallback((value: string, maskChar: string = DEFAULT_MASK) => {
        return isValueVisible ? value : maskChar;
    }, [isValueVisible]);

    return (
        <PrivacyContext.Provider value={{
            isValueVisible,
            toggleValueVisibility,
            setValueVisible,
            maskValue,
        }}>
            {children}
        </PrivacyContext.Provider>
    );
}

export function usePrivacy() {
    const context = useContext(PrivacyContext);
    if (context === undefined) {
        // Fallback for components outside the provider
        return {
            isValueVisible: true,
            toggleValueVisibility: () => { },
            setValueVisible: () => { },
            maskValue: (value: string) => value,
        };
    }
    return context;
}
