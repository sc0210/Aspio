import { act, renderHook } from '@testing-library/react';
import { usePortfolioFilters } from '@/hooks/portfolio/usePortfolioFilters';
import { usePortfolioModals } from '@/hooks/portfolio/usePortfolioModals';
import { usePortfolioEdit } from '@/hooks/portfolio/usePortfolioEdit';
import type { Goal, PortfolioHolding } from '@/shared/types';

const holding = (overrides: Partial<PortfolioHolding> = {}) =>
  ({ id: 'h1', symbol: '0050', quantity: 10, averageCost: 100, currentPrice: 150, ...overrides }) as PortfolioHolding;
const goal = { id: 'g1', title: 'Trip' } as Goal;

describe('usePortfolioFilters', () => {
  beforeEach(() => sessionStorage.clear());

  it('starts from the defaults', () => {
    const { result } = renderHook(() => usePortfolioFilters());
    expect(result.current.filters).toEqual({ type: 'all', walletType: 'all', sortBy: 'value', sortOrder: 'desc' });
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.hasCustomSort).toBe(false);
  });

  it('persists changes and restores them on the next mount', () => {
    const first = renderHook(() => usePortfolioFilters());
    act(() => {
      first.result.current.setType('etf');
      first.result.current.setSortBy('symbol');
    });
    expect(first.result.current.hasActiveFilters).toBe(true);
    expect(first.result.current.hasCustomSort).toBe(true);
    first.unmount();

    const second = renderHook(() => usePortfolioFilters());
    expect(second.result.current.filters.type).toBe('etf');
    expect(second.result.current.filters.sortBy).toBe('symbol');
  });

  it('lets explicit initial values beat the stored ones', () => {
    sessionStorage.setItem('portfolio-filters', JSON.stringify({ type: 'etf' }));
    const { result } = renderHook(() => usePortfolioFilters({ type: 'crypto' }));
    expect(result.current.filters.type).toBe('crypto');
  });

  it('ignores unreadable stored state', () => {
    sessionStorage.setItem('portfolio-filters', '{not json');
    const { result } = renderHook(() => usePortfolioFilters());
    expect(result.current.filters.type).toBe('all');
  });

  it('toggles, sets and resets sort and wallet', () => {
    const { result } = renderHook(() => usePortfolioFilters());
    act(() => result.current.toggleSortOrder());
    expect(result.current.filters.sortOrder).toBe('asc');
    act(() => result.current.setSort('gainLoss'));
    expect(result.current.filters).toMatchObject({ sortBy: 'gainLoss', sortOrder: 'desc' });
    act(() => {
      result.current.setSortOrder('asc');
      result.current.setWalletType('emergency');
    });
    expect(result.current.filters).toMatchObject({ sortOrder: 'asc', walletType: 'emergency' });

    act(() => result.current.resetFilters());
    expect(result.current.filters.walletType).toBe('all');
    // The reset write lands after the removal, so storage holds the defaults.
    expect(JSON.parse(sessionStorage.getItem('portfolio-filters') ?? '{}').walletType).toBe('all');
  });
});

describe('usePortfolioModals', () => {
  it('opens a modal with its data and clears the data on close', () => {
    const { result } = renderHook(() => usePortfolioModals());
    const h = holding();

    act(() => result.current.openSellModal(h));
    expect(result.current.modals.sell).toBe(true);
    expect(result.current.modalData.sellingHolding).toBe(h);
    expect(result.current.isAnyModalOpen).toBe(true);

    act(() => result.current.closeModal('sell'));
    expect(result.current.modals.sell).toBe(false);
    expect(result.current.modalData.sellingHolding).toBeNull();
    expect(result.current.isAnyModalOpen).toBe(false);
  });

  it.each([
    ['buy', 'buyingSymbol', (m: ReturnType<typeof usePortfolioModals>) => m.openBuyModal('AAPL'), 'AAPL'],
    ['editGoal', 'editingGoal', (m: ReturnType<typeof usePortfolioModals>) => m.openEditGoalModal(goal), goal],
    ['contributeGoal', 'contributeGoal', (m: ReturnType<typeof usePortfolioModals>) => m.openContributeModal(goal), goal],
    ['holdingDetail', 'holdingDetailData', (m: ReturnType<typeof usePortfolioModals>) => m.openHoldingDetailModal(holding()), expect.objectContaining({ id: 'h1' })],
  ] as const)('%s keeps %s while open', (name, dataKey, open, expected) => {
    const { result } = renderHook(() => usePortfolioModals());
    act(() => open(result.current));
    expect(result.current.modals[name]).toBe(true);
    expect(result.current.modalData[dataKey]).toEqual(expected);
    act(() => result.current.closeModal(name));
    expect(result.current.modalData[dataKey]).toBeNull();
  });

  it('opens the data-less modals, toggles, and closes everything', () => {
    const { result } = renderHook(() => usePortfolioModals());
    act(() => {
      result.current.openBuyModal();
      result.current.openImportExportModal();
      result.current.openWalletManagementModal();
      result.current.openDebugPanel();
    });
    expect(result.current.modalData.buyingSymbol).toBeNull();
    expect(result.current.modals).toMatchObject({ buy: true, importExport: true, walletManagement: true, debug: true });

    act(() => result.current.toggleModal('debug'));
    expect(result.current.modals.debug).toBe(false);

    act(() => result.current.closeAllModals());
    expect(result.current.isAnyModalOpen).toBe(false);
  });
});

describe('usePortfolioEdit', () => {
  it('fills the form from the holding and cancels back to blank', () => {
    const { result } = renderHook(() => usePortfolioEdit());
    act(() => result.current.startEdit(holding({ sector: 'Tech', purchaseDate: '2026-01-02' })));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.editForm).toEqual({
      quantity: 10, averageCost: 100, currentPrice: 150, sector: 'Tech', purchaseDate: '2026-01-02',
    });

    act(() => {
      result.current.updateEditFormField('quantity', 12);
      result.current.updateEditForm({ sector: 'ETF' });
    });
    expect(result.current.editForm).toMatchObject({ quantity: 12, sector: 'ETF' });

    act(() => result.current.resetEditForm());
    expect(result.current.editForm.quantity).toBe(0);

    act(() => result.current.cancelEdit());
    expect(result.current.isEditing).toBe(false);
  });

  it('defaults missing holding fields', () => {
    const { result } = renderHook(() => usePortfolioEdit());
    act(() => result.current.startEdit({ id: 'x' } as PortfolioHolding));
    expect(result.current.editForm).toEqual({ quantity: 0, averageCost: 0, currentPrice: 0, sector: '', purchaseDate: '' });
  });

  it('tracks a selection without duplicates', () => {
    const { result } = renderHook(() => usePortfolioEdit());
    act(() => {
      result.current.selectHolding('a');
      result.current.selectHolding('a');
      result.current.toggleHoldingSelection('b');
      result.current.selectMultiple(['b', 'c']);
    });
    expect(result.current.selectedHoldings).toEqual(['a', 'b', 'c']);
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isSelected('c')).toBe(true);
    expect(result.current.areAllSelected(['a', 'c'])).toBe(true);

    act(() => {
      result.current.toggleHoldingSelection('b');
      result.current.deselectHolding('a');
    });
    expect(result.current.selectedHoldings).toEqual(['c']);

    act(() => result.current.selectAll(['x', 'y']));
    expect(result.current.selectedHoldings).toEqual(['x', 'y']);
    act(() => result.current.clearSelection());
    expect(result.current.hasSelection).toBe(false);
  });

  it('leaving bulk mode drops the selection', () => {
    const { result } = renderHook(() => usePortfolioEdit());
    act(() => result.current.toggleBulkEdit());
    act(() => result.current.selectHolding('a'));
    act(() => result.current.toggleBulkEdit());
    expect(result.current.bulkEditMode).toBe(false);
    expect(result.current.selectedHoldings).toEqual([]);

    act(() => {
      result.current.enableBulkEdit();
      result.current.selectHolding('b');
    });
    act(() => result.current.disableBulkEdit());
    expect(result.current.hasSelection).toBe(false);
  });
});
