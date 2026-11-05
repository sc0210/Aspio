import { render, screen, fireEvent } from '@testing-library/react';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_k: string, fallback: string) => fallback }),
}));

const HINT = /Want full control/;

describe('BiggerScreenHint', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    // On a first visit it stacked with the demo banner and pushed the dashboard below the fold.
    it('stays hidden for the whole first session', () => {
        render(<BiggerScreenHint />);
        expect(screen.queryByText(HINT)).toBeNull();
        // Navigating back to the dashboard in the same session remounts it.
        render(<BiggerScreenHint />);
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('appears in a later session and stays dismissed', () => {
        render(<BiggerScreenHint />).unmount();
        sessionStorage.clear(); // a new session
        render(<BiggerScreenHint />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByText(HINT)).toBeNull();
        sessionStorage.clear();
        render(<BiggerScreenHint />);
        expect(screen.queryByText(HINT)).toBeNull();
    });
});
