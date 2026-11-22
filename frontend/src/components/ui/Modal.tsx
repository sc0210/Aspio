'use client';

import React from 'react';
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useDialogStackEntry } from '@/hooks/useDialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** One line under the title: what the dialog is about (a goal's name, a symbol). Announced as the dialog's description. */
  description?: React.ReactNode;
  /** Buttons beside the close button (Sell, Delete). */
  headerActions?: React.ReactNode;
  /** Interactive content under the title (an inline edit form). Not announced as the description. */
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  /** Actions pinned under the body, so a long form never scrolls its Save out of reach. */
  footer?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  /** The body's padding and spacing, for content that draws its own (a full-bleed table). */
  bodyClassName?: string;
}

const SIZES = {
  xs: 'sm:max-w-sm',
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-7xl',
} as const;

/**
 * The one dialog. Built on Headless UI: focus is trapped while open and
 * restored to the trigger on close, Escape and the overlay dismiss it, and the
 * page behind it does not scroll. A bottom sheet on a phone, centred above that.
 *
 * Focus lands on the first focusable element; put `data-autofocus` on the field
 * a dialog exists for so it is announced before the close button.
 *
 * NOTE: Headless UI reports Escape and overlay clicks through one onClose
 * callback, so closeOnEscape/closeOnOverlay can only disable dismissal
 * jointly (both false), not independently. No current caller sets them
 * separately; revisit if one ever needs to.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  headerActions,
  headerContent,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
  bodyClassName,
}: ModalProps) {
  // Headless UI locks the document element, but <main> is this app's scroll
  // container — lock that too or the page slides behind the dialog.
  useScrollLock(isOpen);
  useDialogStackEntry(isOpen);
  const { t } = useTranslation('common');

  // Headless UI fires onClose for both Escape and overlay clicks; only wire it
  // through when dismissal is allowed. The explicit close button always works.
  const handleDialogClose = () => {
    if (closeOnOverlay || closeOnEscape) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleDialogClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          className={cn(
            'relative flex w-full flex-col overflow-hidden bg-white dark:bg-gray-800 shadow-xl',
            'rounded-t-2xl sm:rounded-2xl border border-gray-200 dark:border-gray-700',
            'max-h-[90vh] max-h-[90dvh]',
            SIZES[size],
            className
          )}
        >
          {title && (
            <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-5 border-b border-gray-200 dark:border-gray-700">
              <div className="min-w-0 flex-1 pt-1.5">
                <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </DialogTitle>
                {description && (
                  <Description className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {description}
                  </Description>
                )}
                {headerContent && <div className="mt-2">{headerContent}</div>}
              </div>
              {headerActions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5">{headerActions}</div>}
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 shrink-0 text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-lg p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={t('common.close', 'Close modal')}
              >
                <XMarkIcon className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* The bottom padding clears a phone's home indicator. (`pb-safe`, used
              before, was never defined, so it did nothing.) */}
          <div className={cn('min-h-0 flex-1 overflow-y-auto p-4 sm:p-6', !footer && 'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6', bodyClassName)}>
            {children}
          </div>

          {footer && (
            <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-gray-200 dark:border-gray-700 px-4 pt-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function ModalFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700', className)}>
      {children}
    </div>
  );
}
