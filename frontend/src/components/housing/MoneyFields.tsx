'use client';

import { useTranslation } from 'react-i18next';
import { WAN } from '@/lib/housing/readiness';
import { formatMoney } from '@/utils/formatters';
import { usePrivacy } from '@/contexts/PrivacyContext';

/**
 * The housing pages' money inputs. Both panels used to keep a copy of each.
 *
 * Boxed, not underline-only: a bare underline in a grid of labels read as a
 * divider, not as somewhere to type.
 */
export const MONEY_INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 ' +
  'focus-visible:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-white';

const HIDDEN = <span className="block w-full py-1.5 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400">•••</span>;

interface FieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  isValueVisible: boolean;
}

/**
 * Typed in 萬 (×10,000), the unit Taiwanese housing figures are quoted in. An
 * English reader does not count in 萬, so the field also spells the amount out.
 */
export function WanField({ label, value, onChange, isValueVisible }: FieldProps) {
  const { t, i18n } = useTranslation('common');
  const spellOut = !i18n.language?.startsWith('zh');
  return (
    <div>
      <label className="mb-0.5 block text-sm font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <div className="flex items-center gap-1.5">
        {isValueVisible ? (
          <input
            type="number" min={0} step={10} value={Math.round(value / WAN)}
            inputMode="decimal"
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)) * WAN)}
            className={MONEY_INPUT}
            aria-label={label}
          />
        ) : HIDDEN}
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{t('housing.unitWan')}</span>
      </div>
      {spellOut && isValueVisible && (
        <p className="mt-0.5 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">{formatMoney(value, 'TWD')}</p>
      )}
    </div>
  );
}

/**
 * An amount as a housing reader expects it: "1,200 萬" in Chinese, and spelled
 * out in English ("NT$12,000,000"), where "1,200 ×10K" asked the reader to do
 * the multiplication.
 */
export function useWanAmount() {
  const { t, i18n } = useTranslation('common');
  const { isValueVisible } = usePrivacy();
  const zh = i18n.language?.startsWith('zh');
  return (amount: number) => {
    if (!isValueVisible) return '•••';
    return zh ? `${Math.round(amount / WAN).toLocaleString()} ${t('housing.unitWan')}` : formatMoney(amount, 'TWD');
  };
}

/** Typed in whole NT$. */
export function RawField({ label, value, onChange, isValueVisible }: FieldProps) {
  return (
    <div>
      <label className="mb-0.5 block text-sm font-medium text-gray-500 dark:text-gray-400">{label}</label>
      {isValueVisible ? (
        <input
          type="number" min={0} step={1000} value={Math.round(value)}
          inputMode="decimal"
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className={MONEY_INPUT}
          aria-label={label}
        />
      ) : HIDDEN}
    </div>
  );
}
