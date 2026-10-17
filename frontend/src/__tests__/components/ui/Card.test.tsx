/**
 * The white surface the app is built from, and the ratchet that keeps it the
 * only one.
 *
 * The component is thin on purpose — its value is that 73 sites stopped
 * spelling the same thing 42 ways — so what is worth pinning is the small set
 * of decisions callers depend on: that `className` can still win, that the
 * accent hairline forces clipping, and that padding moves inside the card when
 * a hairline is present.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Card } from '@/components/ui/Card';

const box = (c: HTMLElement) => c.firstChild as HTMLElement;

describe('Card', () => {
    it('is a bordered white surface in both themes', () => {
        const { container } = render(<Card>x</Card>);
        expect(box(container)).toHaveClass('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
    });

    it('defaults to the shape most cards use', () => {
        const { container } = render(<Card>x</Card>);
        expect(box(container)).toHaveClass('rounded-2xl', 'shadow-sm', 'p-4', 'sm:p-5');
    });

    it('drops padding entirely for a card whose sections bring their own', () => {
        const { container } = render(<Card padding="none">x</Card>);
        expect(box(container).className).not.toMatch(/\bp-\d/);
    });

    it('lets a caller override a conflicting class', () => {
        // `cn` is twMerge, so this is a real guarantee rather than a hope about
        // stylesheet order — several call sites need a non-grey border.
        const { container } = render(<Card className="border-blue-200">x</Card>);
        expect(box(container)).toHaveClass('border-blue-200');
        expect(box(container)).not.toHaveClass('border-gray-200');
    });

    it('clips when it draws a hairline, or the corners cut through it', () => {
        const { container } = render(<Card accent="rose">x</Card>);
        expect(box(container)).toHaveClass('overflow-hidden');
    });

    it('does not clip by default, so a popover inside can escape', () => {
        const { container } = render(<Card>x</Card>);
        expect(box(container)).not.toHaveClass('overflow-hidden');
    });

    it('moves padding onto the content when a hairline is present', () => {
        // The hairline is the card's own first row. Padding on the card would
        // inset it and it would stop reading as an edge.
        const { container } = render(<Card accent="rose">x</Card>);
        expect(box(container).className).not.toMatch(/\bp-\d/);
        expect(box(container).lastChild).toHaveClass('p-4', 'sm:p-5');
    });

    it('gives each accent its own hairline', () => {
        const { container } = render(<Card accent="green">x</Card>);
        expect((box(container).firstChild as HTMLElement).className).toContain('from-green-400/60');
    });

    it('carries a style through, for what cannot be a class', () => {
        const { container } = render(<Card style={{ transitionDelay: '200ms' }}>x</Card>);
        expect(box(container)).toHaveStyle({ transitionDelay: '200ms' });
    });
});

/**
 * A ratchet. The point of the component is that there is exactly one spelling
 * of this surface; a new hand-rolled one silently makes that false again, and
 * nothing else would notice.
 */
describe('nothing hand-rolls a card any more', () => {
    const SRC = path.join(__dirname, '../../..');
    /**
     * Order-independent on purpose. The first version of this required
     * `bg-white` before `rounded-*`, and the loans summary cards — which spell
     * it the other way round — sailed straight through a run that reported
     * zero hand-rolled cards left.
     *
     * It matches Card's own signature exactly: the white surface, Card's dark
     * value, and the standard border. A different dark value or border colour
     * is a different surface and is not this component's business.
     *
     * It deliberately does not require a literal `className="..."`. The second
     * version did, and `className={cn('bg-white …')}` and `const cardBase =
     * 'bg-white …'` both walked straight past it — the same miss again, one
     * level down. The needle set is specific enough that where the string
     * appears does not matter.
     */
    const SHELL = (line: string) =>
        [
            // Bounded, so a translucent `bg-white/60` is not read as `bg-white`.
            // The pagination bar on /transactions is exactly that, and it is a
            // strip rather than a surface.
            /\bbg-white(?![\w/-])/,
            /\bdark:bg-gray-800(?![\w/-])/,
            /\brounded-(xl|2xl)\b/,
            /\bborder-gray-200(?![\w/-])/,
            /\bdark:border-gray-700(?![\w/-])/,
        ].every((needle) => needle.test(line));

    /**
     * Dialogs, dropdowns and popovers are a different surface — a heavy
     * shadow, a stacking context, a max-width, an entrance animation — and
     * belong to `Modal` or their own menu component, not here.
     */
    // `(?<!hover:)` matters: LoanCard is an ordinary surface that happens to
    // lift on hover, and `hover:shadow-lg` alone had been enough to excuse it.
    const OVERLAY = /(?<!hover:)shadow-(?:lg|xl|2xl)|max-w-|absolute|backdrop-blur|\bz-\d/;

    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
            } else if (entry.name.endsWith('.tsx')) {
                out.push(full);
            }
        }
        return out;
    }

    it('finds the source to check', () => {
        expect(walk(path.join(SRC, 'components')).length).toBeGreaterThan(50);
    });

    it('no content card is written out by hand', () => {
        const offenders: string[] = [];

        for (const file of [...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'components'))]) {
            if (file.endsWith(path.join('ui', 'Card.tsx'))) continue;
            fs.readFileSync(file, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    if (SHELL(line) && !OVERLAY.test(line)) {
                        offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
                    }
                });
        }

        expect(offenders).toEqual([]);
    });
});
