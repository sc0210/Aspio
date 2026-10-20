'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

// NextAuth error codes we have copy for. The message itself lives in auth.json
// under authError.messages.<code>; anything unrecognised falls back to Default.
const KNOWN_ERROR_CODES = [
  'BackendUnavailable',
  'OAuthSignin',
  'OAuthCallback',
  'OAuthCreateAccount',
  'Callback',
] as const;

function AuthErrorContent() {
  const { t } = useTranslation(['auth']);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const code = error && (KNOWN_ERROR_CODES as readonly string[]).includes(error) ? error : 'Default';
  const message = t(`auth:authError.messages.${code}`);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 flex items-center justify-center relative overflow-hidden">
      {/* Decorative circles */}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute -bottom-48 -left-24 w-[32rem] h-[32rem] rounded-full bg-black/10 pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm mx-auto px-4 flex flex-col items-center gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-primary-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <span className="text-xl font-bold text-white">Aspiro</span>
        </Link>

        {/* Card */}
        <div className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-white/20 overflow-hidden">
          <div className="h-px bg-gradient-to-r from-primary-400/60 via-indigo-400/60 to-violet-400/60" />
          <div className="px-6 py-7 text-center">
            {/* Error icon */}
            <div className="flex justify-center mb-5">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-red-700 dark:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t('auth:authError.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              {message}
            </p>

            <Link
              href="/auth/signin"
              className="inline-flex items-center justify-center w-full bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white rounded-xl py-2.5 font-semibold text-sm transition-all duration-200"
            >
              {t('auth:authError.returnToSignIn')}
            </Link>
          </div>
        </div>

        {/* Back link */}
        <Link href="/" className="text-white/70 hover:text-white text-sm transition-colors">
          {t('auth:authError.backToHome')}
        </Link>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  );
}
