'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface AssetTrackingPreferences {
    baseCurrency: string;
    goalAlertDays: number;
    annualReturnTarget: number;
    hideSmallPositions: boolean;
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
}

const STORAGE_KEY = 'aspiro-asset-tracking-preferences';

const DEFAULT_PREFERENCES: AssetTrackingPreferences = {
    baseCurrency: 'TWD',
    goalAlertDays: 90,
    annualReturnTarget: 8,
    hideSmallPositions: false,
    riskTolerance: 'moderate',
};

export function useAssetTrackingPreferences() {
    const [preferences, setPreferences] = useState<AssetTrackingPreferences>(DEFAULT_PREFERENCES);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<AssetTrackingPreferences>;
                setPreferences({
                    baseCurrency: parsed.baseCurrency || DEFAULT_PREFERENCES.baseCurrency,
                    goalAlertDays: parsed.goalAlertDays || DEFAULT_PREFERENCES.goalAlertDays,
                    annualReturnTarget: parsed.annualReturnTarget || DEFAULT_PREFERENCES.annualReturnTarget,
                    hideSmallPositions: parsed.hideSmallPositions ?? DEFAULT_PREFERENCES.hideSmallPositions,
                    riskTolerance: parsed.riskTolerance ?? DEFAULT_PREFERENCES.riskTolerance,
                });
            }
        } catch {
            setPreferences(DEFAULT_PREFERENCES);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    const updatePreference = useCallback(<K extends keyof AssetTrackingPreferences>(key: K, value: AssetTrackingPreferences[K]) => {
        setPreferences((prev) => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // no-op
            }
            return next;
        });
    }, []);

    const resetPreferences = useCallback(() => {
        setPreferences(DEFAULT_PREFERENCES);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES));
        } catch {
            // no-op
        }
    }, []);

    return useMemo(() => ({
        preferences,
        isLoaded,
        updatePreference,
        resetPreferences,
    }), [preferences, isLoaded, updatePreference, resetPreferences]);
}
