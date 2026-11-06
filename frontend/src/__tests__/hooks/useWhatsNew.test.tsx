import { renderHook, act } from '@testing-library/react';
import { useWhatsNew } from '@/hooks/useWhatsNew';
import { CHANGELOG, CURRENT_VERSION } from '@/data/changelog';

const KEY = 'aspiro-whatsnew-seen';

describe('useWhatsNew', () => {
    beforeEach(() => localStorage.clear());

    // The changelog auto-opened on top of a brand-new visitor's first look at the app.
    it('starts a first-ever visitor as up to date', () => {
        const { result } = renderHook(() => useWhatsNew());
        expect(result.current.ready).toBe(true);
        expect(result.current.hasUnseen).toBe(false);
        expect(result.current.unseenEntries).toEqual([]);
        expect(localStorage.getItem(KEY)).toBe(CURRENT_VERSION);
    });

    it('shows a returning visitor the releases since their last visit', () => {
        localStorage.setItem(KEY, '0000.00');
        const { result } = renderHook(() => useWhatsNew());
        expect(result.current.hasUnseen).toBe(true);
        expect(result.current.unseenEntries).toEqual(CHANGELOG);
        act(() => result.current.markSeen());
        expect(result.current.hasUnseen).toBe(false);
        expect(localStorage.getItem(KEY)).toBe(CURRENT_VERSION);
    });
});
