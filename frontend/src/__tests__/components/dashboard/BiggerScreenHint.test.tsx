import { render, screen, fireEvent } from '@testing-library/react';
import { BiggerScreenHint } from '@/components/dashboard/BiggerScreenHint';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_k: string, fallback: string) => fallback }),
}));

const HINT = /Want full control/;

describe('BiggerScreenHint', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => jest.useRealTimers());

    // On a first visit it stacked with the demo banner and pushed the dashboard below the fold.
    it('stays hidden throughout the first visit, in any tab', () => {
        jest.useFakeTimers({ now: new Date('2026-11-05T09:00:00Z') });
        render(<BiggerScreenHint />).unmount();
        jest.setSystemTime(new Date('2026-11-05T11:00:00Z')); // a second tab, two hours on
        render(<BiggerScreenHint />);
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('appears on a later visit and stays dismissed', () => {
        jest.useFakeTimers({ now: new Date('2026-11-05T09:00:00Z') });
        render(<BiggerScreenHint />).unmount();
        jest.setSystemTime(new Date('2026-11-06T09:00:00Z'));
        const { unmount } = render(<BiggerScreenHint />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByText(HINT)).toBeNull();
        unmount();
        render(<BiggerScreenHint />);
        expect(screen.queryByText(HINT)).toBeNull();
    });
});
