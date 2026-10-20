'use client';

import React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars2Icon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import type { Transaction } from '@/shared/types';
import { moveId } from './dayOrder';

const GRID = 'grid grid-cols-1 lg:grid-cols-2 gap-2 animate-fade-in';

interface SortableDayGridProps {
  rows: Transaction[];
  /** False renders the plain grid: searching, filtering, or not sorted by date. */
  enabled: boolean;
  renderRow: (transaction: Transaction, index: number) => React.ReactNode;
  /** The day's ids in their new order, after a drop that moved something. */
  onReorder: (orderedIds: string[]) => void;
}

/**
 * One day's rows, draggable into a new order within the day (#478).
 *
 * Dragging starts only from the handle, so a tap on the row, its checkbox or its
 * menu behaves exactly as before. Touch waits 150ms before it counts as a drag, so
 * a swipe still scrolls the page; the keyboard moves a focused handle with Space
 * and the arrow keys (dnd-kit announces each step to screen readers).
 */
export function SortableDayGrid({ rows, enabled, renderRow, onReorder }: SortableDayGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // One row has nothing to be reordered against.
  if (!enabled || rows.length < 2) {
    return <div className={GRID}>{rows.map((row, i) => renderRow(row, i))}</div>;
  }

  const ids = rows.map((row) => row.id);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = moveId(ids, String(active.id), String(over.id));
    if (next !== ids) onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={GRID}>
          {rows.map((row, i) => (
            <SortableRow key={row.id} transaction={row}>
              {renderRow(row, i)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ transaction, children }: { transaction: Transaction; children: React.ReactNode }) {
  const { t } = useTranslation(['transactions']);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: transaction.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-stretch gap-1', isDragging && 'relative z-10 opacity-80 shadow-lg rounded-lg')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('transactions:list.reorderHandle', {
          description: transaction.description,
          defaultValue: 'Drag to reorder {{description}}',
        })}
        className="flex-shrink-0 w-6 flex items-center justify-center rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Bars2Icon className="w-4 h-4" aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
