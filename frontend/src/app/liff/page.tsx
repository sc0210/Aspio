'use client';

/**
 * LIFF bootstrapper.
 *
 * Opened from inside LINE (the bot posts a liff.line.me/{LIFF_ID} button). It:
 *   1. inits the LIFF SDK and ensures the user is logged into LINE,
 *   2. mints a real Aspiro NextAuth session from the LINE ID token via
 *      signIn('liff') (the 'liff' provider calls POST /line-bot/liff/session — see
 *      backend liff_session). This sets the session cookie so the middleware-gated
 *      app routes are reachable inside LINE's in-app browser, where no session
 *      previously existed,
 *   3. routes into the existing app: the group detail page when opened from a
 *      group/room, otherwise the dashboard.
 *
 * This page must stay in the middleware PUBLIC_PATHS allowlist — it runs before any
 * session exists. Unlinked LINE users are told to run /link in their chat first.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { apiClient } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useTranslation } from 'react-i18next';
import { LineBotGate } from '@/components/line/LineBotGate';

type Phase = 'starting' | 'not_linked' | 'redirecting' | 'error';

export default function LiffBootstrapPage() {
  // useSearchParams must be under a Suspense boundary (Next.js App Router).
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <LineBotGate standalone>
        <LiffBootstrap />
      </LineBotGate>
    </Suspense>
  );
}

function LiffBootstrap() {
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        setError(t('common:lineLink.liffNotConfigured'));
        setPhase('error');
        return;
      }

      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          liff.login(); // redirects out to LINE login, then back here
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          setError(t('common:lineLink.liffNoIdentity'));
          setPhase('error');
          return;
        }

        // Exchange the LINE identity for a real Aspiro NextAuth session (sets the
        // session cookie). This is what makes the middleware-gated routes below
        // reachable inside LINE's in-app browser. authorize() returns null for an
        // unlinked LINE account, which surfaces here as result.error.
        const result = await signIn('liff', { idToken, redirect: false });
        if (cancelled) return;

        if (!result || result.error) {
          setPhase('not_linked');
          return;
        }

        // Destination: explicit ?gid=<aspiro group id> wins (the bot can embed it);
        // otherwise resolve the LINE group/room context to an Aspiro group; else dashboard.
        let target = '/dashboard';
        const gid = searchParams?.get('gid');
        if (gid) {
          target = `/groups/${gid}`;
        } else {
          // Groups expose groupId; multi-person chats ("rooms") expose roomId.
          const ctx = liff.getContext() as { groupId?: string; roomId?: string } | null;
          const lineChatId = ctx?.groupId ?? ctx?.roomId;
          if (lineChatId) {
            try {
              const groupsRes = await apiClient.get<Array<{ id: string; line_group_id: string }>>(
                '/line-bot/groups',
              );
              const match = (groupsRes.data ?? []).find((g) => g.line_group_id === lineChatId);
              if (match) target = `/groups/${match.id}`;
            } catch {
              /* fall back to dashboard */
            }
          }
        }

        if (cancelled) return;
        setPhase('redirecting');
        router.replace(target);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to start the Aspiro LIFF app.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {(phase === 'starting' || phase === 'redirecting') && (
          <>
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {phase === 'starting' ? 'Connecting to Aspiro…' : 'Opening…'}
            </p>
          </>
        )}

        {phase === 'not_linked' && (
          <div className="space-y-3">
            <div className="text-5xl">🔗</div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {t('common:lineLink.liffTitle')}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('common:lineLink.liffBodyPrefix')}{' '}
              <span className="font-mono font-semibold">/link</span>{' '}
              {t('common:lineLink.liffBodySuffix')}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">{t('common:lineLink.errorTitle')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}
