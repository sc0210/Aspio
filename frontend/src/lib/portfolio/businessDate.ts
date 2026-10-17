/**
 * The app's business day. The backend dates everything in Asia/Taipei
 * (`business_today()`), so a default or a window built from the viewer's own
 * clock is a day off for anyone west of UTC+8 for part of every day.
 */
const BUSINESS_TIME_ZONE = 'Asia/Taipei';

/** `YYYY-MM-DD` for `now` as a calendar day in Asia/Taipei. */
export function businessToday(now: Date = new Date()): string {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}
