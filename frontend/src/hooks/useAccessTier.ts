'use client';

import type { AccessTier } from '@/lib/access';
import { useAppMode } from './useAppMode';
import { useCurrentUser } from './useCurrentUser';

export interface AccessTierState {
  tier: AccessTier | null;
  /** True only once the account is known to be premium. */
  isPremium: boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The signed-in account's tier, from GET /users/me.
 *
 * `isPremium` is false until the answer arrives, so free-tier surfaces never
 * offer, or fetch, a premium feature they would be refused (403
 * PREMIUM_REQUIRED). Demo mode is the full showcase: premium without asking.
 * A tier change applies on the next page load; the profile query is long-lived.
 */
export function useAccessTier(): AccessTierState {
  const { isDemo } = useAppMode();
  const { data, isLoading, isError } = useCurrentUser();

  if (isDemo) return { tier: 'premium', isPremium: true, isLoading: false, isError: false };

  // A backend older than the tier column sends nothing; it also has no gate,
  // so it is treated as premium rather than hiding pages that still work.
  const tier: AccessTier | null = data ? (data.access_tier ?? 'premium') : null;
  return { tier, isPremium: tier === 'premium', isLoading, isError };
}
