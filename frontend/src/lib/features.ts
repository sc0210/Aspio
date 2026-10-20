/**
 * Optional add-ons an instance may or may not have configured. The backend
 * reports them at GET /features; `useFeatures` reads it.
 */
export interface Features {
  lineBot: boolean;
}

/** Every add-on on: demo mode, and lookups that must resolve any page. */
export const ALL_FEATURES: Features = { lineBot: true };
