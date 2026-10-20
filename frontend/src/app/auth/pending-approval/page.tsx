'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export default function PendingApprovalPage() {
  const [dots, setDots] = useState('');
  const { t } = useTranslation(['auth']);

  // Animate the waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 600);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth/signin' });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 flex items-center justify-center relative overflow-hidden px-4">
      {/* Decorative circles */}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute -bottom-48 -left-24 w-[32rem] h-[32rem] rounded-full bg-black/10 pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm mx-auto flex flex-col items-center gap-6">
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
          <div className="px-6 py-7">
            {/* Animated clock icon */}
            <div className="flex justify-center mb-5">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-amber-200 dark:border-amber-800" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-amber-500 dark:border-t-amber-400 animate-spin" style={{ animationDuration: '2s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-amber-500 dark:text-amber-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
              </div>
            </div>

            <h1 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-1">
              {t('auth:pendingApproval.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-500 text-center mb-5">
              {t('auth:pendingApproval.waiting')}<span className="inline-block w-5 text-left">{dots}</span>
            </p>

            <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-600 to-transparent mb-5" />

            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed text-center mb-1">
              {t('auth:pendingApproval.line1')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed text-center">
              {t('auth:pendingApproval.line2')}
            </p>

            {/* Progress steps */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-700 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-300">{t('auth:pendingApproval.steps.registered')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-300">{t('auth:pendingApproval.steps.review')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-500" />
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-500">{t('auth:pendingApproval.steps.granted')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-white/50">
            {t('auth:pendingApproval.mistake')}
          </p>
          <button
            onClick={handleSignOut}
            className="text-white/70 hover:text-white text-sm transition-colors underline underline-offset-2"
          >
            {t('auth:pendingApproval.signOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
