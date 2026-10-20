'use client';

import { LineBotGate } from '@/components/line/LineBotGate';
import { useEffect, useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { apiClient } from '@/lib/api-client';
import { useAppMode } from '@/hooks/useAppMode';
import { useTranslation } from 'react-i18next';

type State = 'loading' | 'needs_login' | 'linking' | 'success' | 'error';

const GoogleIcon = (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const LineLogo = (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="#06C755">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

function LinkLineContent() {
  const { t } = useTranslation(['common']);
  const { isAuthenticated, isLoading } = useAppMode();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token');

  const [state, setState] = useState<State>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [linkedDisplayName, setLinkedDisplayName] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMsg(t('common:lineLink.noToken'));
      return;
    }

    if (isLoading) return;

    if (!isAuthenticated) {
      setState('needs_login');
      return;
    }

    // Logged in — call the link-confirm endpoint
    setState('linking');

    apiClient.post<{ display_name?: string }>('/line-bot/link-confirm', { token })
      .then((res) => {
        setLinkedDisplayName(res.data?.display_name || '');
        setState('success');
      })
      .catch((err) => {
        setErrorMsg(err.message || t('common:lineLink.errorRetry'));
        setState('error');
      });
  }, [isAuthenticated, isLoading, token]);

  const handleGoogleSignIn = () => {
    signIn('google', {
      callbackUrl: `/link-line?token=${token}`,
    });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {LineLogo}
          <span className="text-gray-500 dark:text-gray-400 text-2xl font-light">×</span>
          <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
        </div>

        <h1 className="text-xl font-semibold text-center text-gray-900 dark:text-white mb-2">
          {t('common:lineLink.connectTitle')}
        </h1>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-8">
          {t('common:lineLink.connectSubtitle')}
        </p>

        {/* States */}
        {(state === 'loading' || state === 'linking') && (
          <div className="flex flex-col items-center gap-3 py-6">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {state === 'linking' ? 'Linking your account…' : 'Loading…'}
            </p>
          </div>
        )}

        {state === 'needs_login' && (
          <div className="space-y-4">
            <p className="text-sm text-center text-gray-600 dark:text-gray-300">
              {t('common:lineLink.signInHint')}
            </p>
            <button
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              {GoogleIcon}
              Continue with Google
            </button>
          </div>
        )}

        {state === 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-7 h-7 text-green-700 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900 dark:text-white">{t('common:lineLink.linkedTitle')}</p>
              {linkedDisplayName && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {t('common:lineLink.linkedAs')} <span className="font-medium">{linkedDisplayName}</span>
                </p>
              )}
            </div>
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              {t('common:lineLink.tryPrefix')} <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-700 dark:text-inherit">/balance</span> {t('common:lineLink.tryOr')} <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-700 dark:text-inherit">/add 150 coffee</span>
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-700 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900 dark:text-white">{t('common:lineLink.errorTitle')}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{errorMsg}</p>
            </div>
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              {t('common:lineLink.runPrefix')} <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-700 dark:text-inherit">/link</span> {t('common:lineLink.runSuffix')}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function LinkLinePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    }>
      <LineBotGate standalone>
        <LinkLineContent />
      </LineBotGate>
    </Suspense>
  );
}
