'use client';

import { useState, useMemo, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import toast from 'react-hot-toast';
import {
  EyeIcon,
  EyeSlashIcon,
  EnvelopeIcon,
  LockClosedIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { safeCallbackPath } from '@/lib/safe-callback';

// Built inside the component so its messages come from `t`; only the shape is
// needed at module scope.
type FormData = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  // Optional to match what yup infers from .oneOf([true]) — the schema still
  // rejects anything but true, so the form cannot submit without it.
  terms?: boolean;
};

const MIN_PASSWORD_LENGTH = 8;


const FEATURES = [
  { emoji: '🚀', title: 'Start your FIRE journey', desc: 'Set your financial independence date and work backwards' },
  { emoji: '📈', title: 'Track every investment', desc: 'Stocks, ETFs, crypto — all in one dashboard' },
  { emoji: '🧠', title: 'AI-powered insights', desc: 'Get personalized recommendations from your own data' },
  { emoji: '🔒', title: 'Bank-grade security', desc: 'Your data is encrypted and never sold' },
];

const GoogleIcon = (
  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd))   score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return { score: 1, label: 'Weak',   color: 'bg-red-500' };
  if (score <= 2) return { score: 2, label: 'Fair',   color: 'bg-amber-500' };
  if (score <= 3) return { score: 3, label: 'Good',   color: 'bg-yellow-500' };
  if (score <= 4) return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
  return             { score: 5, label: 'Very strong', color: 'bg-emerald-600' };
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();
  const { t } = useTranslation(['auth']);

  const schema = useMemo(
    () =>
      yup.object({
        name: yup.string().required(t('auth:errors.nameRequired')),
        email: yup
          .string()
          .email(t('auth:errors.emailInvalidShort'))
          .required(t('auth:errors.emailRequired')),
        password: yup
          .string()
          .min(MIN_PASSWORD_LENGTH, t('auth:errors.passwordMinChars', { count: MIN_PASSWORD_LENGTH }))
          .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, t('auth:errors.passwordComplexity'))
          .required(t('auth:errors.passwordRequired')),
        confirmPassword: yup
          .string()
          .oneOf([yup.ref('password')], t('auth:errors.passwordsMustMatch'))
          .required(t('auth:errors.confirmPasswordRequired')),
        terms: yup.boolean().oneOf([true], t('auth:errors.termsAccept')),
      }),
    [t],
  );
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackPath(searchParams?.get('callbackUrl'));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({ resolver: yupResolver(schema) });

  const passwordValue = watch('password') ?? '';
  const strength = getPasswordStrength(passwordValue);

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      // Registration lives under /users, not /auth — posting to auth/register
      // 404'd, so this form silently created nothing. The backend also requires
      // confirm_password and terms_accepted; the form already collects both, it
      // just wasn't sending them, which would have 422'd once the path was right.
      const response = await fetch('/api/proxy/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
          confirm_password: data.confirmPassword,
          terms_accepted: data.terms,
        }),
      });
      if (response.ok) {
        router.push('/auth/pending-approval');
      } else {
        // Errors come back in the ApiResponse envelope, so the message sits at
        // error.error.message — reading error.message showed every failure as
        // the generic fallback.
        const body = await response.json().catch(() => null);
        toast.error(body?.error?.message || body?.message || t('auth:signUp.toast.createFailed'));
      }
    } catch {
      toast.error(t('auth:signUp.toast.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsGoogleLoading(true);
    try {
      await signIn('google', { redirect: true, callbackUrl });
    } catch {
      toast.error(t('auth:signUp.toast.googleFailed'));
      setIsGoogleLoading(false);
    }
  };

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-2">

      {/* ── Left panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-indigo-600 via-primary-700 to-primary-800 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-black/10 pointer-events-none" />

        <Link href="/" className="flex items-center gap-2.5 relative z-10 w-fit">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <span className="text-xl font-bold text-white">Aspiro</span>
        </Link>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight mb-3">
              {t('auth:signUp.heroTitle')}
            </h1>
            <p className="text-indigo-200 text-base leading-relaxed">
              {t('auth:signUp.heroSubtitle')}
            </p>
          </div>
          <div className="space-y-4">
            {FEATURES.map(({ emoji, title, desc }) => (
              <div key={title} className="flex items-center gap-3.5">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                  {emoji}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm leading-tight">{title}</p>
                  <p className="text-indigo-300 text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-indigo-400 text-xs relative z-10">{t('auth:signIn.copyright', { year: new Date().getFullYear() })}</p>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex flex-col justify-center py-8 px-5 sm:px-8 lg:px-12 bg-gray-50 dark:bg-gray-900">
        {/* Mobile logo */}
        <div className="lg:hidden flex justify-center mb-7">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-primary-600 rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg">A</span>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">Aspiro</span>
          </Link>
        </div>

        <div className="w-full max-w-sm mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('auth:signUp.createTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('auth:signUp.haveAccount')}{' '}
              <Link href="/auth/signin" className="font-semibold text-primary-700 dark:text-primary-400 hover:text-primary-800">
                {t('auth:signUp.signInInstead')}
              </Link>
            </p>
          </div>

          {/* Form card */}
          <Card padding="none" clip>
            <div className="h-px bg-gradient-to-r from-indigo-400/60 via-primary-400/60 to-violet-400/60" />
            <div className="px-6 py-6 space-y-4">

              {/* Google — shown first on signup to encourage SSO */}
              <button
                type="button"
                onClick={handleGoogleSignUp}
                disabled={isGoogleLoading}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {isGoogleLoading ? <LoadingSpinner size="sm" /> : GoogleIcon}
                {t('auth:signUp.continueWithGoogle')}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-600" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">{t('auth:signUp.orSignUpWithEmail')}</span>
                </div>
              </div>

              <form className="space-y-3.5" onSubmit={handleSubmit(onSubmit)}>
                <Input
                  {...register('name')}
                  type="text"
                  label={t('auth:signUp.name')}
                  error={errors.name?.message}
                  placeholder={t('auth:signUp.namePlaceholder')}
                  autoComplete="name"
                  leftIcon={<UserIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                />

                <Input
                  {...register('email')}
                  type="email"
                  label={t('auth:signUp.email')}
                  error={errors.email?.message}
                  placeholder={t('auth:signUp.emailPlaceholder')}
                  autoComplete="email"
                  leftIcon={<EnvelopeIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                />

                <div>
                  <Input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    label={t('auth:signUp.password')}
                    error={errors.password?.message}
                    placeholder={t('auth:signUp.passwordPlaceholder')}
                    autoComplete="new-password"
                    leftIcon={<LockClosedIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                    rightIcon={
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(v => !v)}
                        className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    }
                  />
                  {/* Strength bar */}
                  {passwordValue.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 flex gap-1">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div
                            key={i}
                            className={cn(
                              'h-1 flex-1 rounded-full transition-all duration-300',
                              i <= strength.score ? strength.color : 'bg-gray-200 dark:bg-gray-600'
                            )}
                          />
                        ))}
                      </div>
                      <span className={cn('text-xs font-semibold flex-shrink-0', {
                        'text-red-500':     strength.score <= 1,
                        'text-amber-500':   strength.score === 2,
                        'text-yellow-700 dark:text-yellow-500':  strength.score === 3,
                        'text-emerald-500': strength.score >= 4,
                      })}>
                        {strength.label}
                      </span>
                    </div>
                  )}
                </div>

                <Input
                  {...register('confirmPassword')}
                  type={showConfirm ? 'text' : 'password'}
                  label={t('auth:signUp.confirmPassword')}
                  error={errors.confirmPassword?.message}
                  placeholder={t('auth:signUp.confirmPasswordPlaceholder')}
                  autoComplete="new-password"
                  leftIcon={<LockClosedIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
                  rightIcon={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirm(v => !v)}
                      className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      {showConfirm ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  }
                />

                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <input
                      {...register('terms')}
                      id="terms"
                      type="checkbox"
                      className="h-4 w-4 mt-0.5 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500 border-gray-300 dark:border-gray-600 rounded flex-shrink-0"
                    />
                    <label htmlFor="terms" className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                      {/* Split into parts rather than one interpolated string:
                          two links sit inside the sentence, and the pieces
                          reorder cleanly in Chinese (我同意 + 服務條款 + 與 + 隱私政策). */}
                      {t('auth:signUp.agreePrefix')}{' '}
                      <Link href="/terms" className="text-primary-700 dark:text-primary-400 hover:underline">{t('auth:signUp.termsLink')}</Link>
                      {' '}{t('auth:signUp.agreeAnd')}{' '}
                      <Link href="/privacy" className="text-primary-700 dark:text-primary-400 hover:underline">{t('auth:signUp.privacyLink')}</Link>
                    </label>
                  </div>
                  {errors.terms && (
                    <p className="text-xs text-red-700 dark:text-red-400 ml-6">{errors.terms.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  fullWidth
                  isLoading={isLoading}
                  className="bg-gradient-to-r from-indigo-600 to-primary-600 hover:from-indigo-700 hover:to-primary-700 border-0 shadow-md hover:shadow-lg transition-all duration-200 mt-1"
                >
                  {t('auth:signUp.signUpButton')}
                </Button>
              </form>

            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
