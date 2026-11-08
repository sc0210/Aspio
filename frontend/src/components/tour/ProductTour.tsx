'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  TOUR_EVENT, readTourMemory, tourFor, writeTourMemory, type Tour, type TourStep,
} from '@/lib/tour/tours';

const PAD = 6;       // spotlight margin around the target
const GAP = 12;      // between the target and the card
const EDGE = 16;     // keep the card this far from the viewport edge
const CARD_W = 340;

/** The element a step points at, if it's on screen in this layout. */
function targetOf(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`);
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    // Hidden layouts measure 0×0; a closed drawer (the sidebar on a phone) has
    // a size but sits off the side of the screen. Vertical is fine: we scroll.
    const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
    if (onScreen && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Steps that can be shown here: centred cards, and those whose marker is visible. */
export function visibleSteps(tour: Tour): TourStep[] {
  return tour.steps.filter((s) => !s.target || targetOf(s) !== null);
}

function anotherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]:not([data-tour-card])') !== null;
}

/**
 * Page tours. Mounted once in DashboardLayout.
 *
 * Nothing blocks the page unless the user asks: the first dashboard visit in a
 * browser offers a small, dismissible invitation, and the top bar's "?" starts
 * (or replays) the current page's tour. A tour spotlights each part of the page
 * in turn with a short caption; Esc, Skip or Done ends it.
 */
export function ProductTour() {
  const { t } = useTranslation('common');
  const pathname = usePathname();
  const tour = tourFor(pathname);

  const [steps, setSteps] = useState<TourStep[] | null>(null);  // null: not running
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const [invite, setInvite] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    if (!tour) return;
    setInvite(false);
    writeTourMemory({ prompted: true });
    setSteps(visibleSteps(tour));
    setIndex(0);
  }, [tour]);

  const finish = useCallback(() => {
    if (tour) writeTourMemory({ prompted: true, done: [...new Set([...readTourMemory().done, tour.id])] });
    setSteps(null);
    setRect(null);
  }, [tour]);

  // The "?" button (and anything else) starts the tour through an event.
  useEffect(() => {
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [start]);

  // A new page ends a running tour; its own tour is one press away.
  useEffect(() => {
    setSteps(null);
    setRect(null);
  }, [pathname]);

  // First dashboard visit in this browser: invite, once the page has settled and
  // nothing else (What's New) is asking for attention.
  useEffect(() => {
    if (tour?.id !== 'dashboard' || readTourMemory().prompted) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (!anotherDialogOpen()) {
        setInvite(true);
        window.clearInterval(timer);
      } else if (tries > 40) {
        window.clearInterval(timer);  // never got a quiet moment; ask next visit
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [tour?.id]);

  const step = steps?.[index];

  // Bring the target into view, then measure it; keep measuring as the page moves.
  useLayoutEffect(() => {
    if (!step) return;
    const el = targetOf(step);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);  // <main> scrolls, not window
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  // Focus the card on each step, so a screen reader reads it and keys reach it.
  useEffect(() => {
    if (!step) return;
    cardRef.current?.focus();
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [step]);

  // Which steps exist is re-checked on every move: a part of the page that was
  // still loading when the tour started gets its step once it's there.
  const move = useCallback((by: 1 | -1) => {
    if (!steps || !tour) return;
    const current = steps[index];
    const fresh = visibleSteps(tour);
    const at = fresh.findIndex((s) => s.key === current.key && s.target === current.target);
    const target = (at === -1 ? index : at) + by;
    if (target >= fresh.length) { finish(); return; }
    setSteps(fresh);
    setIndex(Math.max(0, target));
  }, [steps, index, tour, finish]);
  const next = useCallback(() => move(1), [move]);
  const back = useCallback(() => move(-1), [move]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, next, back, finish]);

  const dismissInvite = () => {
    setInvite(false);
    writeTourMemory({ prompted: true });
  };

  if (invite && !steps) {
    return (
      <div
        role="region"
        aria-label={t('tour.invite.label', 'Take a tour')}
        className="fixed z-40 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 w-[min(320px,calc(100vw-2rem))] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4"
      >
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('tour.invite.title', 'New to Aspiro?')}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('tour.invite.body', 'Take a one-minute tour of what’s on this page. You can replay it any time from the ? button.')}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={start}
            className="min-h-[44px] px-4 rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold">
            {t('tour.invite.start', 'Show me around')}
          </button>
          <button type="button" onClick={dismissInvite}
            className="min-h-[44px] px-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('tour.invite.later', 'Not now')}
          </button>
        </div>
      </div>
    );
  }

  if (!steps || !step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const width = Math.min(CARD_W, vw - EDGE * 2);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + PAD + GAP;
    const fitsBelow = below + cardHeight <= vh - EDGE;
    const top = fitsBelow ? below : Math.max(EDGE, rect.top - PAD - GAP - cardHeight);
    const left = Math.min(Math.max(EDGE, rect.left), vw - width - EDGE);
    cardStyle = { top, left, width };
  } else {
    cardStyle = { top: '50%', left: '50%', width, transform: 'translate(-50%, -50%)' };
  }

  const last = index === steps.length - 1;
  return (
    <div className="fixed inset-0 z-[60]" data-testid="product-tour">
      {/* Catches clicks so the page underneath can't be used mid-tour. */}
      <div className="absolute inset-0" aria-hidden="true" onClick={(e) => e.stopPropagation()}
        style={rect ? undefined : { background: 'rgba(17, 24, 39, 0.55)' }} />
      {rect && (
        <div aria-hidden="true" className="absolute rounded-xl ring-2 ring-primary-400 transition-all duration-200 pointer-events-none"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(17, 24, 39, 0.55)',
          }} />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-tour-card=""
        tabIndex={-1}
        style={cardStyle}
        className="absolute bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-4 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-primary-700 dark:text-primary-400">
            {t('tour.progress', '{{n}} of {{total}}', { n: index + 1, total: steps.length })}
          </p>
          <button type="button" onClick={finish} aria-label={t('tour.skip', 'Skip tour')}
            className="-mt-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <h2 id="tour-title" className="text-base font-semibold text-gray-900 dark:text-white">
          {t(`tour.${step.key}.title`, step.title)}
        </h2>
        <p id="tour-body" className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t(`tour.${step.key}.body`, step.body)}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={finish}
            className="min-h-[44px] px-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            {t('tour.skip', 'Skip tour')}
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={back}
                className="min-h-[44px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('tour.back', 'Back')}
              </button>
            )}
            <button type="button" onClick={next}
              className="min-h-[44px] px-4 rounded-lg bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold">
              {last ? t('tour.done', 'Done') : t('tour.next', 'Next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
