'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppMode } from '@/hooks/useAppMode';
import { cn } from '@/utils/cn';

interface DemoLockedProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Standard "locked in demo mode" affordance. Renders children unchanged when
 * data can persist; in demo mode it dims them, blocks interaction, and shows
 * a localized tooltip. Wrap actions that would write real data.
 */
export function DemoLocked({ children, className }: DemoLockedProps) {
  const { canPersistData } = useAppMode();
  const { t } = useTranslation('common');

  if (canPersistData) return <>{children}</>;

  return (
    <span
      className={cn('inline-flex opacity-60 cursor-not-allowed', className)}
      title={t('modeAware.lockedTooltip', 'Available after signing in')}
      aria-disabled="true"
    >
      <span className="pointer-events-none inline-flex w-full">{children}</span>
    </span>
  );
}
