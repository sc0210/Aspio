import { CSSProperties, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { ACCENTS, type Accent } from './accent';

/**
 * The white surface almost every screen in this app is built from.
 *
 * It was written out by hand 73 times, in 42 different spellings, and the
 * differences are mostly not decisions: `rounded-xl` beside `rounded-2xl` for
 * the same kind of panel, `border-gray-100` where everything else says
 * `border-gray-200`, `p-5` beside `p-4 sm:p-5`. Nothing was wrong on any one
 * screen; there was just no way to change what a card looks like without
 * finding all 73 and agreeing with yourself 42 times.
 *
 * The props below are deliberately the axes that actually varied, and nothing
 * more. Anything genuinely one-off — a grid span, a fixed height, a hover
 * translate — goes through `className`, which is merged last so a caller can
 * always win.
 *
 * Not for dialogs. A modal surface is a different thing (`shadow-2xl`, its own
 * dark value, a max-width, an entrance animation) and belongs to `Modal`.
 */

const PADDING = {
    none: '',
    sm: 'p-4',
    md: 'p-4 sm:p-5',
    lg: 'p-6',
    xl: 'p-8',
} as const;

const RADIUS = {
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
} as const;

const SHADOW = {
    none: '',
    sm: 'shadow-sm',
    lg: 'shadow-lg',
} as const;

interface CardProps {
    children?: ReactNode;
    /** For a surface that is also a landmark. Interactive cards stay a div
     *  inside a link — a card is not itself a control. */
    as?: 'div' | 'section' | 'article';
    /** `none` is for a card whose sections bring their own padding. */
    padding?: keyof typeof PADDING;
    radius?: keyof typeof RADIUS;
    shadow?: keyof typeof SHADOW;
    /** Draws the hairline. Implies clipping, or the corners cut through it. */
    accent?: Accent;
    /** `overflow-hidden` — needed when anything reaches the rounded edge. */
    clip?: boolean;
    /** The lift-on-hover used by cards that are themselves links. */
    hover?: boolean;
    className?: string;
    /** For a value that cannot be a class — a per-item stagger delay, say. */
    style?: CSSProperties;
}

export function Card({
    children,
    as: Tag = 'div',
    padding = 'md',
    radius = '2xl',
    shadow = 'sm',
    accent,
    clip,
    hover = false,
    className,
    style,
}: CardProps) {
    const clipped = clip ?? Boolean(accent);

    return (
        <Tag
            style={style}
            className={cn(
                'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
                RADIUS[radius],
                SHADOW[shadow],
                clipped && 'overflow-hidden',
                hover && 'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
                // The hairline is the card's own first row, so padding has to
                // sit on the content rather than the card.
                !accent && PADDING[padding],
                className,
            )}
        >
            {accent ? (
                <>
                    <div className={cn('h-px bg-gradient-to-r', ACCENTS[accent])} />
                    <div className={PADDING[padding]}>{children}</div>
                </>
            ) : (
                children
            )}
        </Tag>
    );
}
