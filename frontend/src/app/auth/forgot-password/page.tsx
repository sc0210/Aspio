'use client';

import { useState, useMemo, ReactNode } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useTranslation } from 'react-i18next';

// Built inside the component (below) so its messages come from `t`; only the
// inferred shape is needed at module scope.
type FormData = { email: string };


export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation(['auth']);

  const schema = useMemo(
    () =>
      yup.object({
        email: yup
          .string()
          .email(t('auth:errors.emailInvalidShort'))
          .required(t('auth:errors.emailRequired')),
      }),
    [t],
  );
  const [emailSent, setEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      });

      if (response.ok) {
        setEmailSent(true);
        toast.success(t('auth:forgotPassword.toast.sent'));
      } else {
        const error = await response.json();
        toast.error(error.message || t('auth:forgotPassword.toast.sendFailed'));
      }
    } catch {
      toast.error(t('auth:forgotPassword.toast.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendEmail = async () => {
    const email = getValues('email');
    if (!email) {
      toast.error(t('auth:forgotPassword.toast.emailFirst'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        toast.success(t('auth:forgotPassword.toast.resent'));
      } else {
        toast.error(t('auth:forgotPassword.toast.resendFailed'));
      }
    } catch {
      toast.error(t('auth:forgotPassword.toast.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <PageShell>
        <div className="px-6 py-7 text-center">
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            {t('auth:forgotPassword.checkEmailTitle')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            We&apos;ve sent a reset link to{' '}
            <strong className="text-gray-700 dark:text-gray-300">{getValues('email')}</strong>.
            Follow the instructions to reset your password.
          </p>

          <div className="space-y-3">
            <Button
              onClick={handleResendEmail}
              fullWidth
              variant="secondary"
              isLoading={isLoading}
            >
              {t('auth:forgotPassword.resendEmail')}
            </Button>

            <Button
              asChild
              fullWidth
              className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
            >
              <Link href="/auth/signin">{t('auth:forgotPassword.backToSignIn')}</Link>
            </Button>
          </div>

          <p className="mt-5 text-xs text-gray-400 dark:text-gray-500">
            {t('auth:forgotPassword.didntReceive')}{' '}
            <button
              onClick={handleResendEmail}
              className="text-primary-400 hover:text-primary-300 font-semibold transition-colors"
              disabled={isLoading}
            >
              {t('auth:forgotPassword.tryAgain')}
            </button>
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="px-6 py-7 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('auth:forgotPassword.pageTitle')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('auth:forgotPassword.pageSubtitle')}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            {...register('email')}
            type="email"
            label={t('auth:forgotPassword.email')}
            error={errors.email?.message}
            placeholder={t('auth:forgotPassword.emailPlaceholder')}
            autoComplete="email"
            leftIcon={
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          />

          <Button
            type="submit"
            fullWidth
            isLoading={isLoading}
            className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
          >
            {t('auth:forgotPassword.sendResetLink')}
          </Button>
        </form>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['auth']);
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
          {children}
        </div>

        {/* Back link */}
        <Link href="/auth/signin" className="text-white/70 hover:text-white text-sm transition-colors">
          {t('auth:forgotPassword.backToSignIn')}
        </Link>
      </div>
    </main>
  );
}
