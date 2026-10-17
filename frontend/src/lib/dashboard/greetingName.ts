import { demoUser } from '@/data/demoData';

/**
 * The first name a dashboard greets. Demo mode greets the demo persona from the
 * fixtures; the three dashboards each had their own literal ("Alex" on the full
 * view, "Sam" on the compact and mobile ones), so the same demo user had two names.
 */
export function greetingName(
    isDemo: boolean,
    user: { name?: string | null } | null | undefined,
    fallback: string,
): string {
    const full = isDemo ? demoUser.name : user?.name;
    return full?.toString().trim().split(/\s+/)[0] || fallback;
}
