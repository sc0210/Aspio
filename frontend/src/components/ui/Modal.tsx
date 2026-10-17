'use client';

import React from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { useScrollLock } from '@/hooks/useScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

/**
 * Shared modal built on Headless UI Dialog: focus is trapped while open and
 * restored to the trigger on close, body scroll is locked, and Escape/overlay
 * dismissal are handled by the dialog itself.
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
  children,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
}: ModalProps) {
  // Headless UI locks the document element, but <main> is this app's scroll
  // container — lock that too or the page slides behind the dialog.
  useScrollLock(isOpen);
  const { t } = useTranslation('common');

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  // Headless UI fires onClose for both Escape and overlay clicks; only wire it
  // through when dismissal is allowed. The explicit close button always works.
  const handleDialogClose = () => {
    if (closeOnOverlay || closeOnEscape) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleDialogClose} className="relative z-50">
      <div className="fixed inset-0 bg-black bg-opacity-50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
        <DialogPanel
          className={cn(
            'relative bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-lg shadow-xl w-full border border-gray-200 dark:border-gray-700 max-h-[90vh] max-h-[90dvh] overflow-y-auto',
            sizeClasses[size],
            className
          )}
        >
          {title && (
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-white">
                {title}
              </DialogTitle>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded-lg p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={t('common.close', 'Close modal')}
              >
                <XMarkIcon className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="p-4 sm:p-6 pb-safe">
            {children}
          </div>
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
