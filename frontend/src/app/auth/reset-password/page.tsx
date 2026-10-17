'use client';

import { useState, useMemo, Suspense, ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { EyeIcon, EyeSlashIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useTranslation } from 'react-i18next';

// Built inside the component so its messages come from `t`.
type FormData = {
  new_password: string;
  confirm_password: string;
};

const MIN_PASSWORD_LENGTH = 8;


function ResetPasswordForm() {
  const router = useRouter();
  const { t } = useTranslation(['auth']);

  const schema = useMemo(
    () =>
      yup.object({
        new_password: yup
          .string()
          .min(MIN_PASSWORD_LENGTH, t('auth:errors.passwordMinChars', { count: MIN_PASSWORD_LENGTH }))
          .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, t('auth:errors.passwordComplexity'))
          .required(t('auth:errors.newPasswordRequired')),
        confirm_password: yup
          .string()
          .oneOf([yup.ref('new_password')], t('auth:errors.passwordsMustMatch'))
          .required(t('auth:errors.confirmPasswordRequired')),
      }),
    [t],
  );
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: yupResolver(schema) });

  const onSubmit = async (data: FormData) => {
    if (!token) {
      toast.error(t('auth:resetPassword.toast.invalidToken'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: data.new_password, confirm_password: data.confirm_password }),
      });

      if (response.ok) {
        setResetDone(true);
        toast.success(t('auth:resetPassword.toast.success'));
        setTimeout(() => router.push('/auth/signin'), 3000);
      } else {
        const error = await response.json();
        toast.error(error.message || t('auth:resetPassword.toast.failed'));
      }
    } catch {
      toast.error(t('auth:resetPassword.toast.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <PageShell>
        <div className="px-6 py-7 text-center">
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('auth:resetPassword.invalidLinkTitle')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {t('auth:resetPassword.invalidLinkBody')}
          </p>
          <Button
            asChild
            fullWidth
            className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
          >
            <Link href="/auth/forgot-password">{t('auth:resetPassword.requestNewLink')}</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  if (resetDone) {
    return (
      <PageShell>
        <div className="px-6 py-7 text-center">
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('auth:resetPassword.doneTitle')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {t('auth:resetPassword.doneBody')}
          </p>
          <Button
            asChild
            fullWidth
            className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
          >
            <Link href="/auth/signin">{t('auth:resetPassword.signInNow')}</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="px-6 py-7 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('auth:resetPassword.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('auth:resetPassword.chooseStrong')}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            {...register('new_password')}
            type={showPassword ? 'text' : 'password'}
            label={t('auth:resetPassword.password')}
            error={errors.new_password?.message}
            placeholder={t('auth:resetPassword.passwordPlaceholder')}
            autoComplete="new-password"
            leftIcon={<LockClosedIcon className="w-4 h-4 text-gray-400" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            }
          />

          <Input
            {...register('confirm_password')}
            type={showConfirm ? 'text' : 'password'}
            label={t('auth:resetPassword.confirmPassword')}
            error={errors.confirm_password?.message}
            placeholder={t('auth:resetPassword.confirmPlaceholder')}
            autoComplete="new-password"
            leftIcon={<LockClosedIcon className="w-4 h-4 text-gray-400" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowConfirm(p => !p)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            }
          />

          <Button
            type="submit"
            fullWidth
            isLoading={isLoading}
            className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 text-white rounded-xl py-2.5 font-semibold text-sm"
          >
            {t('auth:resetPassword.resetPassword')}
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
          {t('auth:resetPassword.backToSignIn')}
        </Link>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
