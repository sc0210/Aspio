import type { ReactNode } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

/**
 * The one in-page demo notice. The banner at the top of every page already says
 * this is a demo, so a page adds one of these only where demo mode locks an
 * action, and the text names that action ("Sign in to set your own targets"),
 * not the fact of the demo again.
 *
 * Three spellings came before it: an amber box, a blue box, and a dismissible
 * pill with a party emoji.
 */
export function DemoNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
        'border-primary-200 bg-primary-50 text-primary-800',
        'dark:border-primary-700/50 dark:bg-primary-900/20 dark:text-primary-200',
        className,
      )}
    >
      <LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
