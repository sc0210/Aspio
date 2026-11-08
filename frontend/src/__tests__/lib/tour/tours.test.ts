import en from '@/locales/en/common.json';
import zh from '@/locales/zh-TW/common.json';
import { TOURS, readTourMemory, tourFor, writeTourMemory } from '@/lib/tour/tours';

const lookup = (bundle: Record<string, unknown>, path: string) =>
  path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);

describe('tour definitions', () => {
  it('finds the tour for a page, and none elsewhere', () => {
    expect(tourFor('/dashboard')?.id).toBe('dashboard');
    expect(tourFor('/')?.id).toBe('dashboard');
    expect(tourFor('/savings')?.id).toBe('savings');
    expect(tourFor('/settings')).toBeUndefined();
    expect(tourFor(null)).toBeUndefined();
  });

  it('opens every tour with a centred card, so a tour always has something to show', () => {
    for (const tour of TOURS) expect(tour.steps[0].target).toBeUndefined();
  });

  it.each([['en', en], ['zh-TW', zh]])('has every step translated in %s', (_lang, bundle) => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        expect(lookup(bundle as Record<string, unknown>, `tour.${step.key}.title`)).toEqual(expect.any(String));
        expect(lookup(bundle as Record<string, unknown>, `tour.${step.key}.body`)).toEqual(expect.any(String));
      }
    }
  });

  it('keeps English fallbacks identical to the en locale', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        expect(lookup(en as Record<string, unknown>, `tour.${step.key}.title`)).toBe(step.title);
        expect(lookup(en as Record<string, unknown>, `tour.${step.key}.body`)).toBe(step.body);
      }
    }
  });
});

describe('tour memory', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and merges updates', () => {
    expect(readTourMemory()).toEqual({ prompted: false, done: [] });
    writeTourMemory({ prompted: true });
    writeTourMemory({ done: ['dashboard'] });
    expect(readTourMemory()).toEqual({ prompted: true, done: ['dashboard'] });
  });

  it('survives junk in storage', () => {
    localStorage.setItem('aspiro-tour', '{not json');
    expect(readTourMemory()).toEqual({ prompted: false, done: [] });
  });
});
