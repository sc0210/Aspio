'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { ACCENTS, type Accent } from '@/components/ui/accent';

/**
 * The header a page renders for itself — on phones only.
 *
 * `DashboardLayout` already names the page in the desktop top bar, via
 * `PageTitle`. So a page that draws its own heading at every width says the
 * same thing twice and emits a second `<h1>`; one that draws it only on
 * desktop says it nowhere on a phone. The rule is: the top bar owns the
 * desktop title, this owns the phone title, and neither is optional.
 *
 * That was already the shape seven pages had converged on, copied between
 * them by hand — which is why the ones that were copied earliest had drifted
 * to `rounded-xl`, `text-2xl`, `text-3xl` and `text-sm` headings. Holding it
 * in one component is what stops the next page from inventing an eighth.
 */

type PageHeaderAccent = Accent;

interface PageHeaderProps {
    title: string;
    /** One line under the title. Skip it rather than restating the title. */
    subtitle?: ReactNode;
    accent?: PageHeaderAccent;
    /** Buttons for this page, laid out at the end of the row. */
    actions?: ReactNode;
    /**
     * A back affordance, for a page reached from inside another. On desktop the
     * top bar shows the parent as a breadcrumb instead, so this is phone-only
     * like the rest of the card. Give it a destination, or a handler when the
     * useful move is back through history.
     */
    backHref?: string;
    onBack?: () => void;
    backLabel?: string;
    className?: string;
}

export function PageHeader({
    title,
    subtitle,
    accent = 'prosperity',
    actions,
    backHref,
    onBack,
    backLabel,
    className,
}: PageHeaderProps) {
    const back = backHref ? (
        <Link
            href={backHref}
            aria-label={backLabel}
            className="-ml-2 p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            <ArrowLeftIcon className="w-5 h-5" />
        </Link>
    ) : onBack ? (
        <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="-ml-2 p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            <ArrowLeftIcon className="w-5 h-5" />
        </button>
    ) : null;

    return (
        <div
            className={cn(
                'md:hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in',
                className,
            )}
        >
            <div className={cn('h-px bg-gradient-to-r', ACCENTS[accent])} />
            <div className="px-4 sm:px-6 py-4 sm:py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1 min-w-0">
                        {back}
                        <div className="min-w-0">
                            <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                                {title}
                            </h1>
                            {subtitle && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
            </div>
        </div>
    );
}
