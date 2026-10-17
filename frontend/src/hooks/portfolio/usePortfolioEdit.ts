import { useState, useCallback } from 'react';
import type { PortfolioHolding } from '@/shared/types';

/**
 * Edit form data structure
 */
interface EditFormData {
  quantity: number;
  averageCost: number;
  currentPrice: number;
  sector: string;
  purchaseDate: string;
}

/**
 * Default edit form values
 */
const DEFAULT_EDIT_FORM: EditFormData = {
  quantity: 0,
  averageCost: 0,
  currentPrice: 0,
  sector: '',
  purchaseDate: '',
};

/**
 * Portfolio edit hook
 *
 * Manages editing state for portfolio holdings including:
 * - Single holding editing
 * - Bulk editing mode
 * - Selected holdings tracking
 * - Edit form state
 *
 * This hook consolidates 4 useState declarations related to editing
 * into a single focused hook with clear methods.
 *
 * @example
 * ```tsx
 * function HoldingsList() {
 *   const editState = usePortfolioEdit();
 *
 *   return (
 *     <div>
 *       <button onClick={editState.toggleBulkEdit}>
 *         {editState.bulkEditMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
 *       </button>
 *
 *       {holdings.map(holding => (
 *         <HoldingRow
 *           key={holding.id}
 *           holding={holding}
 *           selected={editState.selectedHoldings.includes(holding.id)}
 *           onSelect={() => editState.toggleHoldingSelection(holding.id)}
 *           onEdit={() => editState.startEdit(holding)}
 *         />
 *       ))}
 *
 *       {editState.editingHolding && (
 *         <EditModal
 *           holding={editState.editingHolding}
 *           form={editState.editForm}
 *           onUpdate={editState.updateEditForm}
 *           onSave={editState.saveEdit}
 *           onCancel={editState.cancelEdit}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePortfolioEdit() {
  // Currently editing holding (null if not editing)
  const [editingHolding, setEditingHolding] = useState<PortfolioHolding | null>(null);

  // Selected holdings for bulk operations
  const [selectedHoldings, setSelectedHoldings] = useState<string[]>([]);

  // Bulk edit mode flag
  const [bulkEditMode, setBulkEditMode] = useState(false);

  // Edit form data
  const [editForm, setEditForm] = useState<EditFormData>(DEFAULT_EDIT_FORM);

  /**
   * Start editing a holding
   * Populates the edit form with the holding's current data
   */
  const startEdit = useCallback((holding: PortfolioHolding) => {
    setEditingHolding(holding);
    setEditForm({
      quantity: holding.quantity || 0,
      averageCost: holding.averageCost || 0,
      currentPrice: holding.currentPrice || 0,
      sector: holding.sector || '',
      purchaseDate: holding.purchaseDate || '',
    });
  }, []);

  /**
   * Cancel editing and reset form
   */
  const cancelEdit = useCallback(() => {
    setEditingHolding(null);
    setEditForm(DEFAULT_EDIT_FORM);
  }, []);

  /**
   * Update a single field in the edit form
   */
  const updateEditFormField = useCallback((field: keyof EditFormData, value: EditFormData[keyof EditFormData]) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }, []);

  /**
   * Update multiple fields in the edit form at once
   */
  const updateEditForm = useCallback((updates: Partial<EditFormData>) => {
    setEditForm(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Reset edit form to default values
   */
  const resetEditForm = useCallback(() => {
    setEditForm(DEFAULT_EDIT_FORM);
  }, []);

  /**
   * Toggle bulk edit mode
   * When exiting bulk mode, clears selected holdings
   */
  const toggleBulkEdit = useCallback(() => {
    setBulkEditMode(prev => {
      const newMode = !prev;
      // Clear selections when exiting bulk mode
      if (!newMode) {
        setSelectedHoldings([]);
      }
      return newMode;
    });
  }, []);

  /**
   * Enable bulk edit mode
   */
  const enableBulkEdit = useCallback(() => {
    setBulkEditMode(true);
  }, []);

  /**
   * Disable bulk edit mode and clear selections
   */
  const disableBulkEdit = useCallback(() => {
    setBulkEditMode(false);
    setSelectedHoldings([]);
  }, []);

  /**
   * Toggle a holding's selection status
   */
  const toggleHoldingSelection = useCallback((holdingId: string) => {
    setSelectedHoldings(prev =>
      prev.includes(holdingId)
        ? prev.filter(id => id !== holdingId)
        : [...prev, holdingId]
    );
  }, []);

  /**
   * Select a holding (add to selection)
   */
  const selectHolding = useCallback((holdingId: string) => {
    setSelectedHoldings(prev =>
      prev.includes(holdingId) ? prev : [...prev, holdingId]
    );
  }, []);

  /**
   * Deselect a holding (remove from selection)
   */
  const deselectHolding = useCallback((holdingId: string) => {
    setSelectedHoldings(prev => prev.filter(id => id !== holdingId));
  }, []);

  /**
   * Select all holdings
   */
  const selectAll = useCallback((holdingIds: string[]) => {
    setSelectedHoldings(holdingIds);
  }, []);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedHoldings([]);
  }, []);

  /**
   * Select multiple holdings
   */
  const selectMultiple = useCallback((holdingIds: string[]) => {
    setSelectedHoldings(prev => {
      const newSelection = new Set([...prev, ...holdingIds]);
      return Array.from(newSelection);
    });
  }, []);

  /**
   * Check if a holding is selected
   */
  const isSelected = useCallback((holdingId: string) => {
    return selectedHoldings.includes(holdingId);
  }, [selectedHoldings]);

  /**
   * Check if all provided holdings are selected
   */
  const areAllSelected = useCallback((holdingIds: string[]) => {
    return holdingIds.every(id => selectedHoldings.includes(id));
  }, [selectedHoldings]);

  /**
   * Get count of selected holdings
   */
  const selectedCount = selectedHoldings.length;

  /**
   * Check if any holdings are selected
   */
  const hasSelection = selectedHoldings.length > 0;

  /**
   * Check if currently editing a holding
   */
  const isEditing = editingHolding !== null;

  return {
    // Edit state
    editingHolding,
    isEditing,
    editForm,

    // Edit actions
    startEdit,
    cancelEdit,
    updateEditFormField,
    updateEditForm,
    resetEditForm,

    // Bulk edit state
    bulkEditMode,
    selectedHoldings,
    selectedCount,
    hasSelection,

    // Bulk edit actions
    toggleBulkEdit,
    enableBulkEdit,
    disableBulkEdit,

    // Selection management
    toggleHoldingSelection,
    selectHolding,
    deselectHolding,
    selectAll,
    selectMultiple,
    clearSelection,

    // Selection queries
    isSelected,
    areAllSelected,
  };
}

/**
 * Return type of usePortfolioEdit hook
 * Useful for prop typing in child components
 */
export type PortfolioEditState = ReturnType<typeof usePortfolioEdit>;
