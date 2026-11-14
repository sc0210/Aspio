'use client';

import { CheckIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import {
  CHIP, CHIP_OFF, CHIP_ON, CHIP_ROW, FIELD_LABEL, type PayableGoal,
} from '@/components/transactions/TransactionFormFields';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';

interface GoalFundingPickerProps {
  id: string;
  goals: PayableGoal[];
  value: string;
  onChange: (goalId: string) => void;
}

/**
 * Pay for a holding with a goal's reserved Life cash (goals/reservations.py).
 * The lot then belongs to the goal: its value counts toward it and a sale
 * returns the proceeds to it. Hidden when no goal holds any cash.
 */
export function GoalFundingPicker({ id, goals, value, onChange }: GoalFundingPickerProps) {
  const { t } = useTranslation('goals');
  if (goals.length === 0) return null;
  const chosen = goals.find((g) => g.id === value);

  return (
    <div>
      <div id={`${id}-label`} className={FIELD_LABEL}>
        {t('goals:invest.fundFromGoal')}
      </div>
      <div role="group" aria-labelledby={`${id}-label`} className={CHIP_ROW}>
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange('')}
          className={cn(CHIP, !value ? CHIP_ON : CHIP_OFF)}
        >
          {!value && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {t('goals:invest.fundNone')}
        </button>
        {goals.map((goal) => (
          <button
            key={goal.id}
            type="button"
            aria-pressed={value === goal.id}
            onClick={() => onChange(goal.id)}
            className={cn(CHIP, value === goal.id ? CHIP_ON : CHIP_OFF)}
          >
            {value === goal.id && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {goal.title}
            <span className="font-normal opacity-70">{formatCurrency(goal.reservedAmount, 'TWD', { precision: 0 })}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {chosen
          ? t('goals:invest.fundHint', { amount: formatCurrency(chosen.reservedAmount, 'TWD', { precision: 0 }) })
          : t('goals:invest.fundNoneHint')}
      </p>
    </div>
  );
}
