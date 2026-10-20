'use client';

/**
 * Development-only sign-in panel: type any local account's email and sign in as
 * it without a password.
 *
 * Renders nothing unless NEXT_PUBLIC_DEV_LOGIN_ENABLED is 'true'. That flag only
 * controls whether the UI is offered. The actual bypass lives behind the
 * backend's /auth/dev-login route, which requires DEV_LOGIN_ENABLED, a
 * development ENVIRONMENT, a local database, and a DEV_TOOLS_TOKEN secret that
 * the NextAuth `dev` provider attaches server-side. Turning this flag on
 * without the rest gets you a panel whose every action fails.
 *
 * There is deliberately no account picker: listing accounts meant an
 * unauthenticated endpoint that returned every registered email and role.
 */

import { useCallback, useState } from 'react';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const ENABLED = process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED === 'true';

export function DevSignIn() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDevSignIn = useCallback(async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const result = await signIn('dev', { email: email.trim(), redirect: false });
      if (result?.error) {
        toast.error('Dev sign-in rejected. Check DEV_LOGIN_ENABLED and DEV_TOOLS_TOKEN.');
      } else {
        toast.success(`Signed in as ${email.trim()}`);
        window.location.href = '/';
      }
    } finally {
      setLoading(false);
    }
  }, [email]);

  if (!ENABLED) return null;

  return (
    <div>
      <div className="relative flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="flex-shrink-0">Development only</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      <div className="rounded-xl border border-dashed border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">
          ⚠ Password-less sign-in — local development only
        </p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleDevSignIn();
          }}
          placeholder="account@example.com"
          aria-label="Local account to sign in as"
          autoComplete="off"
          className="w-full py-2 px-3 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        />

        <button
          type="button"
          onClick={handleDevSignIn}
          disabled={loading || !email.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <LoadingSpinner size="sm" /> : <span>🔓</span>}
          Dev sign-in
        </button>
      </div>
    </div>
  );
}
