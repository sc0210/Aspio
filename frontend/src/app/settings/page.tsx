'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  UserIcon,
  MoonIcon,
  SunIcon,
  ComputerDesktopIcon,
  EyeIcon,
  BellIcon,
  ShieldCheckIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Avatar } from '@/components/ui/Avatar';
import { useAppMode } from '@/hooks/useAppMode';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useAssetTrackingPreferences } from '@/hooks/useAssetTrackingPreferences';
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { languages } from '@/lib/i18n';
import { apiClient } from '@/lib/api-client';
import { demoLineLinkStatus } from '@/data/demoData';
import { useFeatures } from '@/hooks/useFeatures';
import { QUERY_KEYS } from '@/hooks/useDataSynchronization';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';
import { hasAnalyticsConsent, isAnalyticsAvailable, setAnalyticsConsent } from '@/lib/analytics/config';
import { analyticsProvider } from '@/lib/analytics/provider';

// Currencies offered for the account default. Kept in sync with the backend
// RegionalPreferencesUpdate pattern — trimmed to the two common ones for our
// users; the DB PreferredCurrency enum still holds the rest for legacy rows.
// (Distinct from the transaction-entry currency list, which stays broad.)
const PREFERRED_CURRENCIES = ['TWD', 'USD'] as const;

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

function SectionCard({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <Card padding="none" radius="xl" shadow="none" clip>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <Icon className="w-4 h-4 text-primary-500 dark:text-primary-400 flex-shrink-0" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </Card>
  );
}

function SettingRow({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5 min-h-[44px]">
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      // aria-disabled, not disabled: a disabled button drops keyboard focus, and
      // these switches go briefly unavailable while their own save is in flight.
      aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={cn(
        'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed touch-manipulation',
        checked ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
      )}
    >
      <span className={cn(
        'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-6' : 'translate-x-1'
      )} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences — stored on the account; the backend's notification
// producers check them (notifications/services.py::create_notification). Only
// switches that a real producer honours are offered.
// ---------------------------------------------------------------------------

const DEFAULT_NOTIF = {
  achievement_notifications: true, // goal reached, achievement unlocked
  transaction_alerts: true, // spending above usual, loan payment due
};
type NotifPrefs = typeof DEFAULT_NOTIF;

function useNotifPrefs(isDemo: boolean) {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF);
  const [loading, setLoading] = useState(!isDemo);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A switch stays disabled while its own save is in flight, so a failed save
  // can only ever revert the one change it carried.
  const [saving, setSaving] = useState<Partial<Record<keyof NotifPrefs, boolean>>>({});

  // Only the latest load may land: demo mode can resolve a render late, and the
  // real request it outran would then 401 and show a load error in demo.
  const latestLoad = useRef(0);
  const load = useCallback(() => {
    const id = ++latestLoad.current;
    setLoadFailed(false);
    if (isDemo) { setLoading(false); return; }
    setLoading(true);
    // `data` is null until the user has saved a preference: every switch is on.
    apiClient.get<Partial<NotifPrefs> | null>('/notifications/preferences')
      .then(res => { if (id === latestLoad.current) setPrefs({ ...DEFAULT_NOTIF, ...(res.data ?? {}) }); })
      .catch(() => { if (id === latestLoad.current) setLoadFailed(true); })
      .finally(() => { if (id === latestLoad.current) setLoading(false); });
  }, [isDemo]);

  useEffect(() => { load(); }, [load]);

  const set = async (key: keyof NotifPrefs, val: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: val }));
    setSaveFailed(false);
    if (isDemo) return;
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await apiClient.patch('/notifications/preferences', { [key]: val });
    } catch {
      setPrefs(prev => ({ ...prev, [key]: !val }));
      setSaveFailed(true);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  };

  return { prefs, set, saving, loading, loadFailed, saveFailed, retry: load };
}

// ---------------------------------------------------------------------------
// LINE Bot section
// ---------------------------------------------------------------------------

type LinkStatus = {
  linked: boolean;
  display_name?: string;
  line_display_name?: string;
  picture_url?: string;
  linked_at?: string;
};

const LineLogo = (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="#06C755">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

function LineBotSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinkError, setUnlinkError] = useState(false);

  const { isDemo } = useAppMode();
  const { t } = useTranslation('common');

  const fetchStatus = useCallback(() => {
    if (isDemo) {
      // Demo mode: use the fixture, never hit the real API (avoids a 401).
      setStatus(demoLineLinkStatus);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(false);
    apiClient.get<LinkStatus>('/line-bot/link-status')
      .then(res => setStatus(res.data ?? null))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [isDemo]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleUnlink = async () => {
    setUnlinking(true);
    setUnlinkError(false);
    if (isDemo) {
      setStatus({ linked: false });
      setConfirmUnlink(false);
      setUnlinking(false);
      return;
    }
    try {
      await apiClient.delete('/line-bot/link');
      setStatus({ linked: false });
      setConfirmUnlink(false);
    } catch {
      setUnlinkError(true);
    } finally {
      setUnlinking(false);
    }
  };

  // The commands themselves are literal bot syntax and stay untranslated.
  const COMMANDS = [
    { cmd: '/txn <amount> <category> <desc>', desc: t('settings.lineBot.commands.txn') },
    { cmd: '/add <amount> <description>', desc: t('settings.lineBot.commands.add') },
    { cmd: '/add 150 coffee paid:@name', desc: t('settings.lineBot.commands.addPaidBy') },
    { cmd: '/add 150 coffee 60:40', desc: t('settings.lineBot.commands.addRatio') },
    { cmd: '/balance', desc: t('settings.lineBot.commands.balance') },
    { cmd: '/settle @name', desc: t('settings.lineBot.commands.settle') },
    { cmd: '/summary', desc: t('settings.lineBot.commands.summary') },
    { cmd: '/history', desc: t('settings.lineBot.commands.history') },
    { cmd: '/undo', desc: t('settings.lineBot.commands.undo') },
  ];

  const CATEGORIES = ['food', 'transport', 'shopping', 'entertainment', 'health', 'other'];

  const displayName = status?.line_display_name || status?.display_name;

  return (
    <SectionCard title={t('settings.lineBot.title')} icon={ChatBubbleLeftRightIcon}>
      {/* Link status card */}
      <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-4 mb-4">
        {loading ? (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 animate-pulse shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <div className="h-2.5 w-32 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </div>
          </div>
        ) : status?.linked ? (
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative shrink-0">
              {status.picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.picture_url}
                  alt={displayName ?? t('settings.lineBot.profileAlt')}
                  className="w-12 h-12 rounded-full object-cover ring-2 ring-[#06C755]/30"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[#06C755]/10 flex items-center justify-center ring-2 ring-[#06C755]/30">
                  {LineLogo}
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#06C755] border-2 border-white dark:border-gray-800 flex items-center justify-center">
                <CheckIcon className="w-2.5 h-2.5 text-white" />
              </span>
            </div>

            {/* Name + linked date */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {displayName ?? t('settings.lineBot.accountFallback')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.lineBot.connected')}{status.linked_at && ` · ${new Date(status.linked_at).toLocaleDateString()}`}
              </p>
            </div>

            {/* Unlink */}
            <div className="shrink-0">
              {confirmUnlink ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.lineBot.unlinkConfirm')}</span>
                    <button
                      onClick={handleUnlink}
                      disabled={unlinking}
                      className="text-xs px-3 py-2 min-h-[44px] rounded-lg bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50 touch-manipulation"
                    >
                      {unlinking ? '…' : t('settings.lineBot.yes')}
                    </button>
                    <button
                      onClick={() => { setConfirmUnlink(false); setUnlinkError(false); }}
                      className="text-xs px-3 py-2 min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors touch-manipulation"
                    >
                      {t('settings.lineBot.cancel')}
                    </button>
                  </div>
                  {unlinkError && (
                    <span className="text-xs text-red-700 dark:text-red-400">{t('settings.lineBot.unlinkFailed')}</span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setConfirmUnlink(true)}
                  className="text-xs px-3 py-2 min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-700 transition-colors touch-manipulation"
                >
                  {t('settings.lineBot.unlink')}
                </button>
              )}
            </div>
          </div>
        ) : fetchError ? (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
              {LineLogo}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.lineBot.loadFailed')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.lineBot.loadFailedHint')}</p>
            </div>
            <button
              onClick={fetchStatus}
              className="shrink-0 text-xs px-3 py-2 min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors touch-manipulation"
            >
              {t('settings.lineBot.retry')}
            </button>
          </div>
        ) : (
          // Linking starts in LINE: /link replies with a one-time /link-line?token=…
          // URL. Opening /link-line from here, without a token, only shows an error.
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                {LineLogo}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.lineBot.notConnected')}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.lineBot.notConnectedHint')}</p>
              </div>
              <button
                onClick={fetchStatus}
                className="shrink-0 text-xs px-3 py-2 min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 touch-manipulation"
              >
                {t('settings.lineBot.checkAgain')}
              </button>
            </div>
            <ol className="mt-3 ml-1 space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
              {(['step1', 'step2', 'step3'] as const).map((step, i) => (
                <li key={step} className="flex gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[#06C755]/10 text-[#05b34d] dark:text-[#06C755] font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{t(`settings.lineBot.connectSteps.${step}`)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Categories */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          {t('settings.lineBot.categoriesTitle')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <span key={c} className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Command reference */}
      <div>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          {t('settings.lineBot.commandsTitle')}
        </p>
        <div className="space-y-1.5">
          {COMMANDS.map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-start gap-2">
              <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-green-700 dark:text-green-400 whitespace-nowrap shrink-0">
                {cmd}
              </code>
              <span className="text-xs text-gray-500 dark:text-gray-400">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { t, i18n } = useTranslation('common');
  const { user, isDemo: isDemoMode } = useAppMode();
  const { lineBot } = useFeatures();
  const { isValueVisible, setValueVisible } = usePrivacy();
  const { preferences, updatePreference, resetPreferences } = useAssetTrackingPreferences();
  const { theme, setTheme } = useTheme();
  const notifPrefs = useNotifPrefs(isDemoMode);
  const { prefs: notif, set: setNotif } = notifPrefs;
  const notifDisabled = notifPrefs.loading || notifPrefs.loadFailed;
  const queryClient = useQueryClient();

  // Usage analytics, the switch the consent banner points to. Shown only where
  // analytics can run at all. Read on first render: this page renders only on the
  // client (SessionInitProvider holds the tree while the session is 'loading').
  const [analyticsAvailable] = useState(() => typeof window !== 'undefined' && isAnalyticsAvailable());
  const [analyticsOn, setAnalyticsOn] = useState(() => typeof window !== 'undefined' && hasAnalyticsConsent());
  const handleAnalyticsChange = (on: boolean) => {
    setAnalyticsConsent(on);
    setAnalyticsOn(on);
    if (on) {
      analyticsProvider.initialize().catch(() => {});
    } else if (document.querySelector('script[data-cf-beacon]')) {
      // A loaded beacon cannot be unloaded; reloading is what stops it.
      window.location.reload();
    }
  };

  // Profile edit state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);

  // Preferred currency (account default for new transactions)
  const [preferredCurrency, setPreferredCurrency] = useState('TWD');
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyMsg, setCurrencyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Seed form with current session/fetched data
  useEffect(() => {
    if (isDemoMode) {
      setDisplayName('Alex Chen');
      setUsername('alexchen');
    } else if (user) {
      setDisplayName(user.name || '');
      // Fetch full profile for username + preferred currency
      apiClient.getCurrentUser?.().then((u) => {
        if (u?.username) setUsername(u.username);
        if (u?.preferred_currency) setPreferredCurrency(u.preferred_currency);
      }).catch(() => {/* ignore */});
    }
  }, [user, isDemoMode]);

  const handleCurrencyChange = async (code: string) => {
    if (isDemoMode) return;
    const previous = preferredCurrency;
    setPreferredCurrency(code); // optimistic
    setCurrencySaving(true);
    setCurrencyMsg(null);
    try {
      await apiClient.updateRegionalPreferences({ preferred_currency: code });
      // Refresh the cached profile so the add-transaction default updates.
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.USER_PROFILE] });
      setCurrencyMsg({ type: 'ok', text: t('settings.currencySaved', 'Preferred currency updated') });
    } catch (err) {
      setPreferredCurrency(previous); // revert on failure
      setCurrencyMsg({ type: 'err', text: err instanceof Error ? err.message : t('settings.currencySaveError', 'Failed to update currency') });
    } finally {
      setCurrencySaving(false);
    }
  };

  const handleProfileSave = async () => {
    if (isDemoMode) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await apiClient.updateUser({ name: displayName, username: username || undefined });
      setProfileMsg({ type: 'ok', text: t('settings.profileSaved', 'Profile saved') });
      setProfileDirty(false);
    } catch (err) {
      setProfileMsg({ type: 'err', text: err instanceof Error ? err.message : t('settings.profileSaveError', 'Failed to save') });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLanguageChange = async (code: string) => {
    await i18n.changeLanguage(code);
    localStorage.setItem('aspiro-language', code);
    // setAttribute (not `.lang =`) so the compiler doesn't flag a direct
    // property mutation of an external object (react-hooks/immutability).
    document.documentElement.setAttribute('lang', code);
  };

  const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('theme.light', 'Light'), icon: <SunIcon className="w-4 h-4" /> },
    { value: 'dark',  label: t('theme.dark', 'Dark'),  icon: <MoonIcon className="w-4 h-4" /> },
    { value: 'system', label: t('theme.system', 'System'), icon: <ComputerDesktopIcon className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-5 pb-10">
        {/* Page header */}
        <div className="md:hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in">
          <div className="h-px bg-gradient-to-r from-slate-400/60 via-gray-400/60 to-blue-400/60" />
          <div className="px-4 py-3">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-white">{t('settings.title', 'Settings')}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('settings.subtitle', 'Manage your account, preferences, and appearance')}
            </p>
          </div>
        </div>

        {isDemoMode && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            👁️ {t('settings.demoNotice', 'Demo mode — profile changes are not saved.')}
          </div>
        )}

        {/* ── Profile ─────────────────────────────────────────────────── */}
        <SectionCard title={t('settings.profile', 'Profile')} icon={UserIcon}>
          {/* Avatar row */}
          <div className="flex items-center gap-4 pb-3 border-b border-gray-100 dark:border-gray-700">
            {/*
              No edit badge here. One used to sit in the bottom-right corner —
              the position people read as "change photo" — but it was a plain
              span whose only behaviour was a "coming soon" tooltip. The picture
              comes from the Google account, so there is nothing to upload to;
              an affordance that looks clickable and isn't costs more than the
              hint was worth.
            */}
            <div className="flex-shrink-0">
              <Avatar
                src={isDemoMode ? '/avatars/demo-user.png' : (user?.image || undefined)}
                alt={displayName || 'User'}
                name={displayName || 'User'}
                size="xl"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white truncate">{displayName || '—'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {isDemoMode ? 'alex.chen@example.com' : (user?.email || '—')}
              </p>
              <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {isDemoMode ? 'Premium' : 'Basic Plan'}
              </span>
            </div>
          </div>

          {/* Editable fields */}
          <div className="space-y-3">
            <div>
              <label htmlFor="settings-display-name" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('settings.displayName', 'Display Name')}
              </label>
              <input
                id="settings-display-name"
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setProfileDirty(true); }}
                disabled={isDemoMode}
                maxLength={60}
                placeholder={t('settings.namePlaceholder', 'Your name')}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="settings-username" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('settings.username', 'Username')}
                <span className="ml-1.5 text-gray-500 dark:text-gray-400 font-normal">
                  ({t('settings.usernameHint', 'used for peer invites')})
                </span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">@</span>
                <input
                  id="settings-username"
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '')); setProfileDirty(true); }}
                  disabled={isDemoMode}
                  maxLength={30}
                  placeholder="your_handle"
                  className="w-full pl-7 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('settings.usernameRules')}</p>
            </div>

            {profileMsg && (
              <div className={cn(
                'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
                profileMsg.type === 'ok'
                  ? 'bg-prosperity-50 text-prosperity-700 dark:bg-prosperity-900/20 dark:text-prosperity-400'
                  : 'bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-400'
              )}>
                {profileMsg.type === 'ok' ? <CheckIcon className="w-3.5 h-3.5" /> : <XMarkIcon className="w-3.5 h-3.5" />}
                {profileMsg.text}
              </div>
            )}

            <button
              onClick={handleProfileSave}
              disabled={isDemoMode || profileSaving || !profileDirty}
              className="w-full py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              {profileSaving ? t('settings.saving', 'Saving…') : t('settings.saveProfile', 'Save Profile')}
            </button>
          </div>
        </SectionCard>

        {/* ── Appearance ──────────────────────────────────────────────── */}
        <SectionCard title={t('settings.appearance', 'Appearance & Language')} icon={MoonIcon}>
          <SettingRow label={t('settings.language', 'Language')} description={t('settings.languageDesc', 'Choose your preferred language')}>
            <div className="flex items-center gap-1">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  aria-pressed={i18n.language === lang.code}
                  aria-label={lang.code === 'zh-TW' ? '繁體中文' : 'English'}
                  className={cn(
                    'px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors touch-manipulation',
                    i18n.language === lang.code
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                  )}
                >
                  {lang.flag} {lang.code === 'zh-TW' ? '繁中' : 'EN'}
                </button>
              ))}
            </div>
          </SettingRow>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <SettingRow label={t('settings.themeLabel', 'Theme')} description={t('settings.themeDesc', 'Light, dark, or follow your system')}>
              <div className="flex items-center gap-1">
                {themeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    aria-pressed={theme === opt.value}
                    aria-label={opt.label}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors touch-manipulation',
                      theme === opt.value
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                    )}
                  >
                    {opt.icon}
                    <span className="hidden sm:inline">{opt.label}</span>
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <SettingRow
              label={t('settings.preferredCurrency', 'Preferred Currency')}
              description={t('settings.preferredCurrencyDesc', 'Default currency for new transactions')}
            >
              <div className="flex flex-col items-end gap-1">
                <select
                  value={preferredCurrency}
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  disabled={isDemoMode || currencySaving}
                  aria-label={t('settings.preferredCurrency', 'Preferred Currency')}
                  className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
                >
                  {PREFERRED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {currencyMsg && (
                  <span className={cn('text-xs', currencyMsg.type === 'ok' ? 'text-prosperity-700 dark:text-prosperity-400' : 'text-error-700 dark:text-error-400')}>
                    {currencyMsg.text}
                  </span>
                )}
              </div>
            </SettingRow>
          </div>
        </SectionCard>

        {/* ── Privacy & Display ────────────────────────────────────────── */}
        <SectionCard title={t('settings.privacy', 'Privacy & Display')} icon={EyeIcon}>
          <SettingRow
            label={t('settings.showValues', 'Show Financial Values')}
            description={t('settings.showValuesDesc', 'Display balances and amounts across the app')}
          >
            <Toggle checked={isValueVisible} onChange={setValueVisible} label={t('settings.showValues', 'Show Financial Values')} />
          </SettingRow>
          {analyticsAvailable && (
            <SettingRow
              label={t('settings.analytics', 'Usage analytics')}
              description={t('settings.analyticsDesc', 'Count page views and load speed to improve Aspiro. Never includes your financial data.')}
            >
              <Toggle checked={analyticsOn} onChange={handleAnalyticsChange} label={t('settings.analytics', 'Usage analytics')} />
            </SettingRow>
          )}
        </SectionCard>

        {/* ── Portfolio Preferences ────────────────────────────────────── */}
        {/* Base currency, hide-small-positions, risk tolerance and the annual
            return target are hidden: they were saved but nothing read them.
            Their fields stay in useAssetTrackingPreferences so stored values
            survive if they come back. */}
        <SectionCard title={t('settings.portfolioPrefs', 'Portfolio Preferences')} icon={ChartBarIcon}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="page-settings-goalalertwindow" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                {t('settings.goalAlertWindow', 'Goal Alert Window')}
              </label>
              <select
                id="page-settings-goalalertwindow"
                value={preferences.goalAlertDays}
                onChange={(e) => updatePreference('goalAlertDays', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {[30, 60, 90, 180].map(d => (
                  <option key={d} value={d}>{d} {t('settings.days', 'days')}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={resetPreferences}
              className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
              {t('settings.resetDefaults', 'Reset to defaults')}
            </button>
          </div>
        </SectionCard>

        {/* ── Notifications ────────────────────────────────────────────── */}
        <SectionCard title={t('settings.notifications', 'Notifications')} icon={BellIcon}>
          {notifPrefs.loadFailed && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
              <p className="text-xs text-red-700 dark:text-red-400">{t('settings.notifLoadFailed')}</p>
              <button
                onClick={notifPrefs.retry}
                className="shrink-0 text-xs px-3 py-2 min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 touch-manipulation"
              >
                {t('settings.lineBot.retry')}
              </button>
            </div>
          )}
          <SettingRow
            label={t('settings.notifGoalsAchievements')}
            description={t('settings.notifGoalsAchievementsDesc')}
          >
            <Toggle
              checked={notif.achievement_notifications}
              onChange={v => setNotif('achievement_notifications', v)}
              disabled={notifDisabled || notifPrefs.saving.achievement_notifications}
              label={t('settings.notifGoalsAchievements')}
            />
          </SettingRow>
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <SettingRow
              label={t('settings.notifSpendingBills')}
              description={t('settings.notifSpendingBillsDesc')}
            >
              <Toggle
                checked={notif.transaction_alerts}
                onChange={v => setNotif('transaction_alerts', v)}
                disabled={notifDisabled || notifPrefs.saving.transaction_alerts}
                label={t('settings.notifSpendingBills')}
              />
            </SettingRow>
          </div>
          {notifPrefs.saveFailed && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('settings.notifSaveFailed')}</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
            {t('settings.notifNote')}
          </p>
        </SectionCard>

        {/* ── Account ──────────────────────────────────────────────────── */}
        {lineBot && <LineBotSection />}

        <SectionCard title={t('settings.account', 'Account')} icon={ShieldCheckIcon}>
          <div className="flex items-center justify-between py-0.5">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.email', 'Email')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isDemoMode ? 'alex.chen@example.com' : (user?.email || '—')}
              </p>
            </div>
            <span className="text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
              {t('settings.readOnly', 'Read-only')}
            </span>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.password', 'Password')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.passwordDesc', 'Change your login password')}</p>
            </div>
            <button
              disabled
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            >
              {t('settings.comingSoon.title', 'Soon')}
            </button>
          </div>

          <div className="border-t border-red-100 dark:border-red-900/30 pt-4">
            <p className="text-xs font-semibold text-error-700 dark:text-error-400 uppercase tracking-wide mb-2">
              {t('settings.dangerZone', 'Danger Zone')}
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.deleteAccount', 'Delete Account')}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.deleteAccountDesc', 'Permanently delete all your data')}</p>
              </div>
              <button
                disabled
                className="text-xs px-3 py-1.5 rounded-lg border border-error-200 dark:border-error-800 text-error-400 cursor-not-allowed"
              >
                {t('settings.delete', 'Delete')}
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </DashboardLayout>
  );
}
