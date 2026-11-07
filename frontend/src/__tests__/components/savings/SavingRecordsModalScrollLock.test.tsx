/**
 * /savings mounts SavingRecordsModal all the time, so a closed one must not hold
 * the page's scroll lock (it did: the page couldn't scroll on any tab).
 * Uses the real useDialog / useScrollLock, unlike SavingRecordsModal.test.tsx.
 */
import React from 'react';
import { render } from '@testing-library/react';
import SavingRecordsModal from '@/components/savings/SavingRecordsModal';
import { demoSharedGoals } from '@/data/demoData';

jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key);
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t }) };
});

jest.mock('@/lib/api-client', () => ({
  apiClient: { getSavingRecords: jest.fn().mockResolvedValue({ data: [] }) },
}));

const props = { isDemo: true, currentUserId: 'u1', onClose: jest.fn(), onRecordChanged: jest.fn() };

function page(goal: typeof demoSharedGoals[number] | null) {
  return (
    <main id="main-content">
      <SavingRecordsModal goal={goal} {...props} />
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
