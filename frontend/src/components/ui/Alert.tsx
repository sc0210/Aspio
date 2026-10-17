import React from 'react';
import {
  XMarkIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';
// Demo-specific alert — compact dismissible pill
export function DemoAlert({ onClose, children, className }: { onClose?: () => void; children?: React.ReactNode; className?: string }) {
  const { t } = useTranslation(['common']);
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-2 rounded-xl text-sm',
      'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/50',
      'text-primary-700 dark:text-primary-300',
      className
    )}>
      <span className="text-base flex-shrink-0">🎉</span>
      <span className="flex-1 min-w-0">
        <strong>{t('common:demoAlert.label')}</strong> {t('common:demoAlert.sampleDataOnly')}
        {children || <span className="font-normal opacity-80"> {t('common:demoAlert.simulated')}</span>}
      </span>
      <button
        onClick={() => { setDismissed(true); onClose?.(); }}
        className="flex-shrink-0 ml-1 p-1 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-800/40 transition-colors"
        aria-label="Dismiss"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
}