'use client';

import { useTranslation } from 'react-i18next';

/**
 * A release's version and date, the date in the reader's language. It was the
 * raw ISO string ("2026-11-07") on a zh-TW page, and the version, which is what
 * a bug report needs, was not shown at all.
 */
export function ReleaseStamp({ version, date }: { version: string; date: string }) {
  const { i18n } = useTranslation();
  // Midday, so no time zone moves a YYYY-MM-DD onto the day before.
  const parsed = new Date(`${date}T12:00:00`);
  const shown = Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(i18n.language || 'en', { dateStyle: 'medium' }).format(parsed);
  return (
    <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
      <span className="font-medium">v{version}</span>
      <span aria-hidden="true"> · </span>
      <time dateTime={date}>{shown}</time>
    </span>
  );
}
