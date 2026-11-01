/**
 * Session-wide actions that more than one navigation surface performs.
 *
 * Signing out and switching language were written out three times — sidebar,
 * mobile More sheet, and now the ⌘K palette. The sidebar's copy skipped the
 * demo-cookie clear on one branch, which is the sort of drift that only shows
 * up as "logged in but seeing demo data".
 */

import { signOut } from 'next-auth/react';

/**
 * Clear the demo cookie, then hand off to NextAuth. NextAuth's signOut event
 * (lib/auth.ts) revokes the refresh token server-side.
 */
export async function signOutCompletely(callbackUrl = '/'): Promise<void> {
  if (typeof document !== 'undefined') {
    document.cookie = 'demo-mode=false; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
  signOut({ callbackUrl });
}

interface LanguageSwitcher {
  changeLanguage: (code: string) => Promise<unknown>;
}

/** Switch language, remember it, and keep <html lang> honest for screen readers. */
export async function changeAppLanguage(i18n: LanguageSwitcher, code: string): Promise<void> {
  await i18n.changeLanguage(code);
  localStorage.setItem('aspiro-language', code);
  // setAttribute (not `.lang =`) so the compiler doesn't flag a direct property
  // mutation of an external object (react-hooks/immutability).
  document.documentElement.setAttribute('lang', code);
}
