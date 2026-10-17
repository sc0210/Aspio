import { cn } from '@/utils/cn';

/**
 * Styles for the controls pages put in DashboardLayout's desktop top bar
 * (`topBarActions`). Every page's bar uses these so its controls line up with
 * every other page's: 34px tall, text-sm medium, rounded-lg.
 *
 * Not <Button size="sm">: its 44px touch-target minimum is for the phone
 * layout, and it made a bar taller than the rest. The minimum height is what
 * keeps an icon-only button level with a labelled one, and the primary's
 * transparent border is what keeps it level with the bordered buttons.
 */

const base =
    'flex items-center gap-2 min-h-[34px] px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed';

/** The default top-bar button. */
export const TOP_BAR_BUTTON = cn(
    base,
    'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:ring-primary-500',
);

/** The page's main action, at most one per bar. */
export const TOP_BAR_PRIMARY = cn(
    base,
    'bg-primary-600 text-white border-transparent hover:bg-primary-700 focus-visible:ring-primary-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-800',
);

/** A <select> styled as a top-bar button. */
export const TOP_BAR_SELECT =
    'min-h-[34px] px-3 py-1.5 leading-5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors cursor-pointer';

/** A segmented control (a view switcher): the bordered group around the segments. */
export const TOP_BAR_SEGMENTED =
    'flex items-center gap-0.5 p-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800';

/** One segment inside TOP_BAR_SEGMENTED; 24px, so the group comes to 34px. */
export function topBarSegment(active: boolean): string {
    return cn(
        'flex items-center gap-1.5 h-6 px-2.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        active
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
    );
}
