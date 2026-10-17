import type { TFunction } from 'i18next';

/**
 * Display labels for a holding's asset type and sector.
 *
 * Both arrive as raw values: the type is an enum (`etf`, `mutual_fund`), and the
 * sector is free text a user can type — except that some sources (the backend's
 * demo holdings) send enum-like keys such as `broad_market`. CSS `capitalize`
 * turned `etf` into "Etf"; rendering the sector verbatim showed `broad_market`.
 */

const SNAKE_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function humanize(key: string): string {
  const words = key.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatAssetTypeLabel(type: string | undefined | null, t: TFunction): string {
  if (!type) return '';
  const key = type.trim().toLowerCase();
  return t(`portfolio:typeBadge.${key}`, { defaultValue: humanize(key) });
}

export function formatSectorLabel(sector: string | undefined | null, t: TFunction): string {
  if (!sector) return '';
  const trimmed = sector.trim();
  // Anything that isn't an enum-like key is the user's own wording; leave it be.
  if (!SNAKE_KEY.test(trimmed)) return trimmed;
  return t(`portfolio:sectors.${trimmed}`, { defaultValue: humanize(trimmed) });
}
