/**
 * Account access tiers (users.access_tier on the backend).
 *
 * A super admin assigns each account a tier; it is not a payment plan. The
 * backend enforces it (403 PREMIUM_REQUIRED on premium routes); the frontend
 * only decides what to show.
 */

export const ACCESS_TIERS = ['free', 'premium'] as const;

export type AccessTier = (typeof ACCESS_TIERS)[number];

export function isAccessTier(value: unknown): value is AccessTier {
  return typeof value === 'string' && (ACCESS_TIERS as readonly string[]).includes(value);
}
