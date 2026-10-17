/**
 * The header 14 pages now share. Its contract is small but load-bearing:
 * a phone-only card, exactly one <h1>, and a back affordance that is reachable
 * by name rather than by the icon inside it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PageHeader } from '@/components/layout/PageHeader';

describe('PageHeader', () => {
    it('hides itself on desktop, where the top bar carries the title', () => {
        const { container } = render(<PageHeader title="Loans" />);
        // Not a style detail — this is the whole reason the component exists.
        // Without it every page renders its name twice above 768px.
        expect(container.firstChild).toHaveClass('md:hidden');
    });

    it('renders the title as the page’s one h1', () => {
        render(<PageHeader title="Loans" />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Loans');
    });

    it('renders a subtitle only when given one', () => {
        const { rerender } = render(<PageHeader title="Loans" />);
        expect(screen.queryByText('What you owe')).not.toBeInTheDocument();

        rerender(<PageHeader title="Loans" subtitle="What you owe" />);
        expect(screen.getByText('What you owe')).toBeInTheDocument();
    });

    it('renders actions', () => {
        render(<PageHeader title="Loans" actions={<button>Add loan</button>} />);
        expect(screen.getByRole('button', { name: 'Add loan' })).toBeInTheDocument();
    });

    it('renders a back link with an accessible name', () => {
        render(<PageHeader title="Monthly summary" backHref="/transactions" backLabel="Back" />);
        expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/transactions');
    });

    it('renders a back button when the useful move is through history', async () => {
        const onBack = jest.fn();
        render(<PageHeader title="Rebalancing" onBack={onBack} backLabel="Back" />);

        screen.getByRole('button', { name: 'Back' }).click();
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('draws no back affordance by default', () => {
        render(<PageHeader title="Loans" />);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('gives each accent its own hairline', () => {
        const { container: rose } = render(<PageHeader title="Loans" accent="rose" />);
        const { container: green } = render(<PageHeader title="Groups" accent="green" />);

        const hairline = (c: HTMLElement) => (c.firstChild as HTMLElement).firstChild as HTMLElement;
        expect(hairline(rose).className).not.toBe(hairline(green).className);
        expect(hairline(rose).className).toContain('from-rose-400/60');
    });
});
