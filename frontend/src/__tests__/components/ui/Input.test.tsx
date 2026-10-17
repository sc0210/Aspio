/**
 * The shared Input, and the two classes it asked for that nothing defines.
 *
 * It rendered its label as `className="label"` and its error state as
 * `input-error`. Neither exists in any stylesheet here, so a labelled field
 * came out unstyled and an invalid field looked identical to a valid one.
 *
 * Neither is latent. /auth/signin and /auth/signup both pass `label` and
 * `error`, so the signed-out front door rendered its labels at browser
 * defaults — 16px, inline, weight 400, no margin, against the 14px/block/500
 * used everywhere else — and a rejected field drew no border at all.
 *
 * The component has 8 importers against 160 raw `<input>` elements, and there
 * are ~175 hand-rolled labels. Reaching for `label`, getting unstyled text,
 * and hand-rolling one instead is the likeliest reason for that ratio.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
    it('styles its label instead of asking for a class nothing defines', () => {
        render(<Input label="Amount" />);
        const label = screen.getByText('Amount');

        // The spelling the hand-rolled labels use, so a converted form looks
        // the same as the ones around it.
        expect(label).toHaveClass('block', 'text-sm', 'font-medium', 'mb-2');
        expect(label.className).not.toMatch(/(^|\s)label(\s|$)/);
    });

    it('associates the label with the input', () => {
        render(<Input label="Amount" />);
        // The point of the component: `htmlFor`/`id` wired without the caller
        // inventing an id. 43 controls in this codebase have no accessible name.
        expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
    });

    it('marks a required field', () => {
        render(<Input label="Amount" required />);
        expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('shows an invalid field as invalid', () => {
        render(<Input label="Amount" error="Too large" />);
        const input = screen.getByLabelText(/Amount/);

        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input.className).not.toMatch(/input-error/);
        expect(input).toHaveClass('border-error-500');
        expect(screen.getByRole('alert')).toHaveTextContent('Too large');
    });

    it('points the input at its error text for screen readers', () => {
        render(<Input label="Amount" error="Too large" />);
        const input = screen.getByLabelText(/Amount/);
        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)).toHaveTextContent('Too large');
    });

    it('leaves a valid field unmarked', () => {
        render(<Input label="Amount" />);
        const input = screen.getByLabelText(/Amount/);
        expect(input).toHaveAttribute('aria-invalid', 'false');
        expect(input).not.toHaveClass('border-error-500');
    });
});
