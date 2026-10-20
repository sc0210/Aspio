'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
} from '@headlessui/react';
import {
  MagnifyingGlassIcon,
  PlusCircleIcon,
  Cog6ToothIcon,
  EyeIcon,
  EyeSlashIcon,
  LanguageIcon,
  MegaphoneIcon,
  ArrowLeftOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useDemo } from '@/contexts/DemoContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { useIsAdmin } from '@/hooks/useAdmin';
import { getNavigationItems, type NavIcon } from '@/lib/navigation';
import { languages } from '@/lib/i18n';
import { changeAppLanguage, signOutCompletely } from '@/lib/session-actions';

const OPEN_EVENT = 'aspiro-command-palette-open';

/** Open the palette from anywhere — the sidebar's search row uses this. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Command {
  id: string;
  label: string;
  icon: NavIcon;
  keywords: string[];
  run: () => void;
}

/**
 * ⌘K over every destination in the app.
 *
 * This is what lets the sidebar stay short. Thirteen rows and growing made the
 * sidebar the only way to reach anything, so every new page had to earn a
 * permanent row; with search, a page costs nothing to reach and the sidebar can
 * hold only the places you return to.
 *
 * Matching runs over the translated label AND per-item keywords in both
 * languages, so "loan" finds 貸款管理 on a Chinese UI and 房貸 finds Housing.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { t, i18n } = useTranslation('common');
  const { isAdmin } = useIsAdmin();
  const { isDemoMode, disableDemo } = useDemo();
  const { isValueVisible, toggleValueVisibility } = usePrivacy();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    };
    const onOpenRequest = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenRequest);
    };
  }, []);

  const pages: Command[] = useMemo(
    () =>
      getNavigationItems(isAdmin).map((item) => ({
        id: item.href,
        label: t(item.nameKey),
        icon: item.icon,
        keywords: [item.href, item.nameKey, ...(item.keywords ?? [])],
        run: () => router.push(item.href),
      })),
    [isAdmin, router, t],
  );

  const actions: Command[] = useMemo(() => {
    const otherLanguage = languages.find((lang) => lang.code !== i18n.language) ?? languages[0];

    return [
      {
        id: 'add-transaction',
        label: t('navigation.addTransaction', 'Add transaction'),
        icon: PlusCircleIcon,
        keywords: ['new', 'expense', 'income', '新增', '記帳'],
        run: () => router.push('/transactions/add'),
      },
      {
        id: 'toggle-privacy',
        label: isValueVisible
          ? t('navigation.hideValues', 'Hide values')
          : t('navigation.showValues', 'Show values'),
        icon: isValueVisible ? EyeSlashIcon : EyeIcon,
        keywords: ['privacy', 'amounts', '隱藏', '金額'],
        run: toggleValueVisibility,
      },
      {
        id: 'switch-language',
        label: `${t('navigation.language', 'Language')} · ${otherLanguage.code === 'zh-TW' ? '繁中' : 'EN'}`,
        icon: LanguageIcon,
        keywords: ['language', 'english', '中文', '語言'],
        run: () => { void changeAppLanguage(i18n, otherLanguage.code); },
      },
      {
        id: 'whats-new',
        label: t('navigation.whatsNew', "What's New"),
        icon: MegaphoneIcon,
        keywords: ['changelog', 'release', '更新'],
        run: () => router.push('/changelog'),
      },
      {
        id: 'settings',
        label: t('navigation.settings'),
        icon: Cog6ToothIcon,
        keywords: ['preferences', 'account', '設定'],
        run: () => router.push('/settings'),
      },
      {
        id: 'sign-out',
        label: isDemoMode ? t('navigation.exitDemo') : t('navigation.signOut'),
        icon: ArrowLeftOnRectangleIcon,
        keywords: ['logout', 'exit', '登出', '退出'],
        run: () => {
          if (isDemoMode) {
            disableDemo();
            return;
          }
          void signOutCompletely('/');
        },
      },
    ];
  }, [disableDemo, i18n, isDemoMode, isValueVisible, router, t, toggleValueVisibility]);

  const matches = useCallback(
    (command: Command) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        command.label.toLowerCase().includes(needle) ||
        command.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
      );
    },
    [query],
  );

  const filteredPages = pages.filter(matches);
  const filteredActions = actions.filter(matches);
  const nothingFound = filteredPages.length === 0 && filteredActions.length === 0;

  const optionClass = ({ focus }: { focus: boolean }) =>
    cn(
      'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
      focus
        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
        : 'text-gray-700 dark:text-gray-300',
    );

  return (
    <Dialog open={open} onClose={close} className="relative z-50">
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]">
        <DialogPanel className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
          <Combobox<Command | null>
            value={null}
            onChange={(command) => {
              if (!command) return;
              close();
              command.run();
            }}
          >
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 dark:border-gray-700">
              <MagnifyingGlassIcon className="w-5 h-5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
              <ComboboxInput
                autoFocus
                aria-label={t('navigation.commandPalette', 'Search pages and actions')}
                placeholder={t('navigation.commandPalettePlaceholder', 'Search pages and actions…')}
                className="w-full bg-transparent py-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
                onChange={(event) => setQuery(event.target.value)}
                value={query}
              />
              <kbd className="hidden sm:block rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 dark:border-gray-600">
                ESC
              </kbd>
            </div>

            <ComboboxOptions static className="max-h-80 overflow-y-auto p-2">
              {nothingFound && (
                <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('navigation.noResults', 'Nothing matches that')}
                </p>
              )}

              {filteredPages.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('navigation.pages', 'Pages')}
                  </p>
                  {filteredPages.map((command) => (
                    <ComboboxOption key={command.id} value={command} className={optionClass}>
                      <command.icon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                      {command.label}
                    </ComboboxOption>
                  ))}
                </>
              )}

              {filteredActions.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('navigation.actions', 'Actions')}
                  </p>
                  {filteredActions.map((command) => (
                    <ComboboxOption key={command.id} value={command} className={optionClass}>
                      <command.icon className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                      {command.label}
                    </ComboboxOption>
                  ))}
                </>
              )}
            </ComboboxOptions>
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
