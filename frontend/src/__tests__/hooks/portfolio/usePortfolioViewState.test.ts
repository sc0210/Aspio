import { renderHook, act } from '@testing-library/react';
import { usePortfolioViewState } from '@/hooks/portfolio/usePortfolioViewState';

describe('usePortfolioViewState', () => {
  // ── initial state ────────────────────────────────────────────────────────────

  it('starts with viewType list', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect(result.current.viewType).toBe('list');
  });

  it('starts with chartType null', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect(result.current.chartType).toBeNull();
  });

  it('starts with dateRangePreset 30', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect(result.current.dateRangePreset).toBe(30);
  });

  it('starts with isDailyPerformanceExpanded false', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect(result.current.isDailyPerformanceExpanded).toBe(false);
  });

  // ── setViewType ───────────────────────────────────────────────────────────────

  it('setViewType switches to allocation', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.setViewType('allocation'));
    expect(result.current.viewType).toBe('allocation');
  });

  it('setViewType switches back to list', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.setViewType('allocation'));
    act(() => result.current.setViewType('list'));
    expect(result.current.viewType).toBe('list');
  });

  // ── setChartType ──────────────────────────────────────────────────────────────

  it('setChartType shows daily chart', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.setChartType('daily'));
    expect(result.current.chartType).toBe('daily');
  });

  it('setChartType(null) hides charts', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.setChartType('trend'));
    act(() => result.current.setChartType(null));
    expect(result.current.chartType).toBeNull();
  });

  // ── toggleDailyPerformance ────────────────────────────────────────────────────

  it('toggleDailyPerformance flips expansion state', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.toggleDailyPerformance());
    expect(result.current.isDailyPerformanceExpanded).toBe(true);
    act(() => result.current.toggleDailyPerformance());
    expect(result.current.isDailyPerformanceExpanded).toBe(false);
  });

  // ── Fix 9: dead state is removed ─────────────────────────────────────────────

  it('does not expose showPeriodComparison', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect('showPeriodComparison' in result.current).toBe(false);
  });

  it('does not expose performanceViewMode', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect('performanceViewMode' in result.current).toBe(false);
  });

  it('does not expose showListView', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect('showListView' in result.current).toBe(false);
  });

  it('does not expose showAllocationView', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect('showAllocationView' in result.current).toBe(false);
  });

  it('does not expose toggleViewType', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    expect('toggleViewType' in result.current).toBe(false);
  });

  // ── Fix 9: DateRangePreset no longer has 3y/5y ──────────────────────────────

  it('setDateRangePreset accepts ytd and max', () => {
    const { result } = renderHook(() => usePortfolioViewState());
    act(() => result.current.setDateRangePreset('ytd'));
    expect(result.current.dateRangePreset).toBe('ytd');
    act(() => result.current.setDateRangePreset('max'));
    expect(result.current.dateRangePreset).toBe('max');
  });
});
