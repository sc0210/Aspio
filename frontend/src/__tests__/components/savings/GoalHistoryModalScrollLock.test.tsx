/**
 * /savings mounts GoalHistoryModal all the time, so a closed one must not hold
 * the page's scroll lock (its predecessor did: the page couldn't scroll on any
 * tab). Uses the real useDialog / useScrollLock, unlike GoalHistoryModal.test.tsx.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import GoalHistoryModal from '@/components/savings/GoalHistoryModal';
import { demoSharedGoals } from '@/data/demoData';

jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key);
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

jest.mock('@/lib/api-client', () => ({
  apiClient: { getSharedGoalHistory: jest.fn().mockResolvedValue({ data: [] }) },
}));

jest.mock('next/dynamic', () => () => function ChartStub() {
  return null;
});

const onClose = jest.fn();

function page(goal: typeof demoSharedGoals[number] | null) {
  return (
    <main id="main-content">
      <GoalHistoryModal goal={goal} isDemo onClose={onClose} />
    </main>
  );
}

it('leaves the page scrollable while no goal is open, and locks it while one is', () => {
  const view = render(page(null));
  const main = document.getElementById('main-content')!;
  expect(main.style.overflow).toBe('');
  expect(document.body.style.overflow).toBe('');

  view.rerender(page(demoSharedGoals[0]));
  expect(main.style.overflow).toBe('hidden');

  view.rerender(page(null));
  expect(main.style.overflow).toBe('');
  expect(document.body.style.overflow).toBe('');
});

it('leaves Escape alone while closed', () => {
  render(page(null));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});
