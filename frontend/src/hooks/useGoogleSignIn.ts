'use client';

import { useEffect, useState } from 'react';
import { getProviders } from 'next-auth/react';
import { useFeatures } from '@/hooks/useFeatures';

/**
 * Whether to offer "Sign in with Google": both halves must be configured. The
 * click runs NextAuth's Google provider (frontend credentials), and the sign-in
 * then exchanges with the backend's Google OAuth (backend config, /features).
 * Hidden until both answers are in, so a Google-less instance never flashes the
 * button.
 */
export function useGoogleSignIn(): boolean {
  const { googleLogin, isLoading } = useFeatures();
  const [frontendHasGoogle, setFrontendHasGoogle] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProviders()
      .then((p) => { if (!cancelled) setFrontendHasGoogle(Boolean(p?.google)); })
      // Unknown: offer it rather than lock anyone out.
      .catch(() => { if (!cancelled) setFrontendHasGoogle(true); });
    return () => { cancelled = true; };
  }, []);

  return frontendHasGoogle === true && !isLoading && googleLogin !== false;
}
