'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

type VerificationStatus = 'loading' | 'success' | 'error' | 'expired' | 'invalid';

interface VerificationState {
  status: VerificationStatus;
  message: string;
  userEmail?: string;
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation(['auth']);
  const [verificationState, setVerificationState] = useState<VerificationState>({
    status: 'loading',
    message: t('auth:verification.status.verifyingMessage'),
  });
  const [isResending, setIsResending] = useState(false);

  const verifyEmail = useCallback(async (token: string, email?: string | null) => {
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });

      const data = await response.json();

      if (response.ok) {
        setVerificationState({
          status: 'success',
          message: t('auth:verification.status.successMessage'),
          userEmail: email || data.email,
        });
        toast.success(t('auth:verification.toast.success'));

        // Redirect to sign-in after 3 seconds
        setTimeout(() => {
          router.push('/auth/signin');
        }, 3000);
      } else {
        const errorStatus: VerificationStatus =
          data.code === 'TOKEN_EXPIRED' ? 'expired' :
          data.code === 'TOKEN_INVALID' ? 'invalid' : 'error';

        setVerificationState({
          status: errorStatus,
          message: data.message || t('auth:verification.status.failedMessage'),
          userEmail: email || undefined,
        });
      }
    } catch {
      setVerificationState({
        status: 'error',
        message: t('auth:verification.status.genericMessage'),
        userEmail: email || undefined,
      });
    }
  }, [router]);

  useEffect(() => {
    const token = searchParams?.get('token');
    const email = searchParams?.get('email');

    if (!token) {
      setVerificationState({
        status: 'invalid',
        message: t('auth:verification.status.invalidMessage'),
        userEmail: email || undefined,
      });
      return;
    }

    verifyEmail(token, email);
    // `t` is included because the invalid-link branch above formats its message
    // with it. react-i18next returns a stable reference, so this does not
    // re-run the verification request.
  }, [searchParams, verifyEmail, t]);

  const handleResendVerification = async () => {
    if (!verificationState.userEmail) {
      toast.error(t('auth:verification.toast.noEmail'));
      return;
    }

    setIsResending(true);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationState.userEmail }),
      });

      if (response.ok) {
        toast.success(t('auth:verification.toast.resent'));
        setVerificationState(prev => ({
          ...prev,
          status: 'loading',
          message: 'A new verification email has been sent. Please check your inbox.',
        }));
      } else {
        const error = await response.json();
        toast.error(error.message || t('auth:verification.toast.resendFailed'));
      }
    } catch {
      toast.error(t('auth:verification.toast.genericError'));
    } finally {
      setIsResending(false);
    }
  };

  const getStatusIcon = () => {
    switch (verificationState.status) {
      case 'loading':
        return (
          <div className="w-14 h-14 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        );
      case 'success':
        return (
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-green-700 dark:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      case 'expired':
        return (
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      case 'error':
      case 'invalid':
      default:
        return (
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-red-700 dark:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        );
    }
  };

  const getStatusTitle = () => {
    switch (verificationState.status) {
      case 'loading':   return t('auth:verification.status.verifyingTitle');
      case 'success':   return t('auth:verification.status.successTitle');
      case 'expired':   return t('auth:verification.status.expiredTitle');
      case 'invalid':   return t('auth:verification.status.invalidTitle');
      case 'error':
      default:          return t('auth:verification.status.failedTitle');
    }
  };

  const getActionButtons = () => {
    switch (verificationState.status) {
      case 'success':
        return (
          <div className="space-y-3">
            <Button
              asChild
              fullWidth
              className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
            >
              <Link href="/auth/signin">{t('auth:verification.continueToSignIn')}</Link>
            </Button>
            <p className="text-xs text-gray-500 dark:text-gray-500 text-center">
              {t('auth:verification.redirecting')}
            </p>
          </div>
        );

      case 'expired':
      case 'invalid':
      case 'error':
        return (
          <div className="space-y-3">
            {verificationState.userEmail && (
              <Button
                onClick={handleResendVerification}
                fullWidth
                isLoading={isResending}
                className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
              >
                {t('auth:verification.sendNewEmail')}
              </Button>
            )}
            <Button asChild fullWidth variant="secondary">
              <Link href="/auth/signup">{t('auth:verification.backToSignUp')}</Link>
            </Button>
            <Button asChild fullWidth variant="ghost">
              <Link href="/auth/signin">{t('auth:verification.alreadyVerified')}</Link>
            </Button>
          </div>
        );

      case 'loading':
      default:
        return null;
    }
  };

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
            <div className="flex justify-center mb-5">
              {getStatusIcon()}
            </div>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {getStatusTitle()}
            </h2>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              {verificationState.message}
            </p>

            {verificationState.userEmail && verificationState.status !== 'loading' && (
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-5">
                {t('auth:verification.emailLabel')} <strong className="text-gray-600 dark:text-gray-300">{verificationState.userEmail}</strong>
              </p>
            )}

            {getActionButtons()}

            {(verificationState.status === 'expired' || verificationState.status === 'invalid' || verificationState.status === 'error') && (
              <div className="mt-5 pt-5 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  Still having trouble?{' '}
                  <a
                    href="mailto:support@aspiro.app"
                    className="text-primary-700 dark:text-primary-400 hover:text-primary-800 font-medium"
                  >
                    {t('auth:verification.contactSupport')}
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Back link */}
        <Link href="/auth/signin" className="text-white/70 hover:text-white text-sm transition-colors">
          {t('auth:verification.backToSignIn')}
        </Link>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
