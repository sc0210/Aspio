'use client';

import React from 'react';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';

interface EmptyStateProps {
  /** Emoji string or an icon element. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional call-to-action, e.g. a Button or Link. */
  action?: React.ReactNode;
  className?: string;
}

/** Standard empty-state card: icon, localized title/description, optional CTA. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Card padding="none" className={cn('p-12 text-center', className)}>
      <div className="max-w-md mx-auto">
        {icon && <div className="text-5xl mb-4">{icon}</div>}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{description}</p>
        )}
        {action && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">{action}</div>
        )}
      </div>
    </Card>
  );
}
