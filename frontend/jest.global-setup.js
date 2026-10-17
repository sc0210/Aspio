/**
 * Pin the suite's timezone to the app's business timezone.
 *
 * Aspiro's calendar day is Asia/Taipei — it decides which month a transaction
 * belongs to — while CI runs UTC and developer machines run whatever they run. Any
 * test that asserts on a day was therefore reading the runner, not the code: a
 * purchase stamped 2026-08-31T20:00Z is Sep 1 here and Aug 31 at UTC, so the same
 * assertion could be correct on one machine and wrong on another.
 *
 * It has to be set here rather than in a test file: assigning `process.env.TZ`
 * inside a jsdom test is inert, because the environment's Date is already bound by
 * then. This runs in the parent process before any worker is forked, and each worker
 * reads TZ at startup, so it takes effect everywhere — and it wins over a TZ set on
 * the command line, which is what keeps the suite deterministic.
 *
 * The pin deliberately overrides TZ, so `TZ=... npx jest` cannot quietly change what
 * the suite means. To reproduce a viewer at another offset on purpose — checking how
 * a date input behaves from abroad, say — set JEST_TZ, which is explicit about being
 * an override:
 *
 *   JEST_TZ=America/Los_Angeles npx jest
 */
module.exports = async () => {
  const override = process.env.JEST_TZ;
  const zone = override || 'Asia/Taipei';

  // A typo — JEST_TZ=Amerca/Los_Angeles — makes ICU fall back to UTC with no error,
  // so the run would happen at UTC while claiming to be abroad, and the suite would
  // go green for the wrong reason. Intl throws RangeError on an unknown zone.
  new Intl.DateTimeFormat('en', { timeZone: zone });

  process.env.TZ = zone;

  if (override) {
    // Said out loud, so an override can never be mistaken for the default — in a CI
    // log least of all.
    console.warn(`[jest] timezone overridden by JEST_TZ: ${zone} (default Asia/Taipei)`);
  }
};
