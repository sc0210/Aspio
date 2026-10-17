/**
 * The hairline that runs across the top of a card.
 *
 * It is the one thing about a surface that is meant to differ per page: a
 * phone screen is a stack of otherwise identical white cards, and the colour
 * is what lets a reader tell "Loans" from "Groups" without reading either.
 *
 * Both `PageHeader` and `Card` draw it, so the palette lives here rather than
 * in whichever of them was written first.
 */
export const ACCENTS = {
    prosperity: 'from-prosperity-400/60 via-primary-400/60 to-primary-300/60',
    indigo: 'from-indigo-400/60 via-purple-400/60 to-violet-400/60',
    blue: 'from-blue-400/60 via-indigo-400/60 to-violet-400/60',
    cyan: 'from-blue-400/60 via-cyan-400/60 to-teal-400/60',
    green: 'from-green-400/60 via-emerald-400/60 to-teal-400/60',
    rose: 'from-rose-400/60 via-red-400/60 to-orange-400/60',
    amber: 'from-amber-400/60 via-yellow-400/60 to-orange-400/60',
    primary: 'from-primary-400/60 via-indigo-400/60 to-violet-400/60',
} as const;

export type Accent = keyof typeof ACCENTS;
