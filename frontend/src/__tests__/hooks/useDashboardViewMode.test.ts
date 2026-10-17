import { renderHook, act } from '@testing-library/react';
import { useDashboardViewMode } from '@/hooks/useDashboardViewMode';

const KEY = 'aspiro-dashboard-view';

describe('useDashboardViewMode', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to "full" when nothing is stored', () => {
        const { result } = renderHook(() => useDashboardViewMode());
        expect(result.current[0]).toBe('full');
    });

    it('reads a stored "compact" preference', () => {
        localStorage.setItem(KEY, 'compact');
        const { result } = renderHook(() => useDashboardViewMode());
        expect(result.current[0]).toBe('compact');
    });

    it('setMode updates state and persists to localStorage', () => {
        const { result } = renderHook(() => useDashboardViewMode());

        act(() => result.current[1]('compact'));
        expect(result.current[0]).toBe('compact');
        expect(localStorage.getItem(KEY)).toBe('compact');

        act(() => result.current[1]('full'));
        expect(result.current[0]).toBe('full');
        expect(localStorage.getItem(KEY)).toBe('full');
    });

    it('keeps two mounted instances in sync via the custom event', () => {
        const a = renderHook(() => useDashboardViewMode());
        const b = renderHook(() => useDashboardViewMode());

        act(() => a.result.current[1]('compact'));

        // Both the toggle button and the page read the same preference, so a flip
        // in one must be reflected in the other immediately.
        expect(a.result.current[0]).toBe('compact');
        expect(b.result.current[0]).toBe('compact');
    });
});
