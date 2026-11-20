/**
 * Optional add-ons an instance may or may not have configured. The backend
 * reports them at GET /features; `useFeatures` reads it.
 */
export interface Features {
  lineBot: boolean;
  /** Google sign-in configured on the backend. Undefined = unknown (show it). */
  googleLogin?: boolean;
  /** Outgoing email (SMTP) configured. Undefined = unknown (assume yes). */
  email?: boolean;
}

/** Every add-on on: demo mode, and lookups that must resolve any page. */
export const ALL_FEATURES: Features = { lineBot: true, googleLogin: true, email: true };
