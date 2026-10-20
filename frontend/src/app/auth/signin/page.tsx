'use client';

import { useState, useMemo, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  EyeIcon,
  EyeSlashIcon,
  EnvelopeIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DevSignIn } from '@/components/auth/DevSignIn';
import { Card } from '@/components/ui/Card';
import { safeCallbackPath } from '@/lib/safe-callback';

// Declared rather than inferred from a module-scope schema: the real schema is
// built inside the component so its messages can come from `t`, and a duplicate
// schema out here purely to infer this type would drift from it.
type FormData = {
  email: string;
  password: string;
};

const MIN_PASSWORD_LENGTH = 6;

// Keys only; the copy lives in auth.json so the emoji/order stay in code and
// the words stay translatable.
const FEATURE_KEYS = ['portfolio', 'goals', 'review', 'wallets'] as const;
const FEATURE_EMOJI: Record<(typeof FEATURE_KEYS)[number], string> = {
  portfolio: '📊',
  goals: '🎯',
  review: '📅',
  wallets: '💰',
};

const GoogleIcon = (
  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { t } = useTranslation(['auth']);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackPath(searchParams?.get('callbackUrl'));

  // Rebuilt when the language changes so validation messages follow the UI.
  const schema = useMemo(
    () =>
      yup.object({
        email: yup
          .string()
          .email(t('auth:errors.emailInvalid'))
          .required(t('auth:errors.emailRequired')),
        password: yup
          .string()
          .min(MIN_PASSWORD_LENGTH, t('auth:errors.passwordMinChars', { count: MIN_PASSWORD_LENGTH }))
          .required(t('auth:errors.passwordRequired')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: yupResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (result?.error === 'PendingApproval') {
        router.push('/auth/pending-approval');
      } else if (result?.error) {
        toast.error(t('auth:signIn.toast.invalidCredentials'));
      } else {
        toast.success(t('auth:signIn.toast.welcome'));
        router.push(callbackUrl);
      }
    } catch {
      toast.error(t('auth:signIn.toast.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setIsDemoLoading(true);
    try {
      const result = await signIn('demo', { redirect: false });
      if (result?.error) {
        toast.error(t('auth:signIn.toast.demoUnavailable'));
      } else {
        toast.success(t('auth:signIn.toast.demoWelcome'));
        router.push('/');
      }
    } catch {
      toast.error(t('auth:signIn.toast.genericError'));
    } finally {
      setIsDemoLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      await signIn('google', { redirect: true, callbackUrl });
    } catch {
      toast.error(t('auth:signIn.toast.googleFailed'));
      setIsGoogleLoading(false);
    }
  };

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-2">

      {/* ── Left panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-black/10 pointer-events-none" />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 relative z-10 w-fit">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <span className="text-xl font-bold text-white">Aspiro</span>
        </Link>

        {/* Headline + features */}
        <div className="relative z-10 space-y-8">
          <div>
            {/* whitespace-pre-line so the translation controls its own line
                break instead of a hard-coded <br /> that only suits English. */}
            <h1 className="text-4xl font-bold text-white leading-tight mb-3 whitespace-pre-line">
              {t('auth:signIn.heroTitle')}
            </h1>
            <p className="text-primary-200 text-base leading-relaxed">
              {t('auth:signIn.heroSubtitle')}
            </p>
          </div>
          <div className="space-y-4">
            {FEATURE_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-3.5">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                  {FEATURE_EMOJI[key]}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm leading-tight">
                    {t(`auth:signIn.features.${key}.title`)}
                  </p>
                  <p className="text-primary-300 text-xs mt-0.5">
                    {t(`auth:signIn.features.${key}.desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-primary-400 text-xs relative z-10">
          {t('auth:signIn.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex flex-col justify-center py-10 px-5 sm:px-8 lg:px-12 bg-gray-50 dark:bg-gray-900">
        {/* Mobile logo */}
        <div className="lg:hidden flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg">A</span>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
          </Link>
        </div>

        <div className="w-full max-w-sm mx-auto">
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('auth:signIn.welcomeBack')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('auth:signIn.noAccount')}{' '}
              <Link href="/auth/signup" className="font-semibold text-primary-700 dark:text-primary-400 hover:text-primary-800">
                {t('auth:signIn.signUpFree')}
              </Link>
            </p>
          </div>

          {/* Form card */}
          <Card padding="none" clip>
            <div className="h-px bg-gradient-to-r from-primary-400/60 via-indigo-400/60 to-violet-400/60" />
            <div className="px-6 py-7 space-y-4">

              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
                <Input
                  {...register('email')}
                  type="email"
                  label={t('auth:signIn.email')}
                  error={errors.email?.message}
                  placeholder={t('auth:signIn.emailPlaceholder')}
                  autoComplete="email"
                  leftIcon={<EnvelopeIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                />

                <div>
                  <Input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    label={t('auth:signIn.password')}
                    error={errors.password?.message}
                    placeholder={t('auth:signIn.passwordPlaceholder')}
                    autoComplete="current-password"
                    leftIcon={<LockClosedIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                    rightIcon={
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(v => !v)}
                        className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        aria-label={showPassword ? t('auth:signIn.hidePassword') : t('auth:signIn.showPassword')}
                      >
                        {showPassword
                          ? <EyeSlashIcon className="w-4 h-4" />
                          : <EyeIcon className="w-4 h-4" />}
                      </button>
                    }
                  />
                  <div className="flex justify-end mt-1.5">
                    <Link href="/auth/forgot-password" className="text-xs text-primary-700 dark:text-primary-400 hover:text-primary-800">
                      {t('auth:signIn.forgotPassword')}
                    </Link>
                  </div>
                </div>

                <Button
                  type="submit"
                  fullWidth
                  isLoading={isLoading}
                  className="bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 border-0 shadow-md hover:shadow-lg transition-all duration-200"
                >
                  {t('auth:signIn.signInButton')}
                </Button>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-600" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">{t('auth:signIn.orDivider')}</span>
                </div>
              </div>

              {/* Google */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {isGoogleLoading ? <LoadingSpinner size="sm" /> : GoogleIcon}
                {t('auth:signIn.signInWithGoogle')}
              </button>

              {/* Demo */}
              <div>
                <div className="relative flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="flex-shrink-0">{t('auth:signIn.justExploring')}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
                <button
                  type="button"
                  onClick={handleDemoSignIn}
                  disabled={isDemoLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isDemoLoading ? <LoadingSpinner size="sm" /> : <span>✦</span>}
                  {t('auth:signIn.tryDemoAccount')}
                </button>
                <p className="mt-1.5 text-center text-xs text-gray-500 dark:text-gray-500">
                  {t('auth:signIn.demoSignsInAs')} <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono text-gray-700 dark:text-inherit">demo@aspiro.dev</code>
                </p>
              </div>

              <DevSignIn />

            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
