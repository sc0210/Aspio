import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardViewToggle } from '@/components/dashboard/DashboardViewToggle';

const KEY = 'aspiro-dashboard-view';

describe('DashboardViewToggle', () => {
    beforeEach(() => localStorage.clear());

    it('renders both options with Full active by default', async () => {
        render(<DashboardViewToggle />);
        const full = await screen.findByRole('button', { name: /full/i });
        const compact = screen.getByRole('button', { name: /compact/i });
        expect(full).toHaveAttribute('aria-pressed', 'true');
        expect(compact).toHaveAttribute('aria-pressed', 'false');
    });

    it('switches to Compact on click and persists the choice', async () => {
        const user = userEvent.setup();
        render(<DashboardViewToggle />);
        const compact = await screen.findByRole('button', { name: /compact/i });

        await user.click(compact);

        expect(compact).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /full/i })).toHaveAttribute('aria-pressed', 'false');
        expect(localStorage.getItem(KEY)).toBe('compact');
    });

    it('switches back to Full', async () => {
        const user = userEvent.setup();
        localStorage.setItem(KEY, 'compact');
        render(<DashboardViewToggle />);
        const full = await screen.findByRole('button', { name: /full/i });

        await user.click(full);

        expect(full).toHaveAttribute('aria-pressed', 'true');
        expect(localStorage.getItem(KEY)).toBe('full');
    });
});
