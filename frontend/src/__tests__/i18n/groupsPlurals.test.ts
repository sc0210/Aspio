/**
 * The groups bundle uses i18next v4 plural suffixes (_one/_other). It once
 * shipped v3 `_plural` keys, which v4 never reads — "2 member" in English.
 */
import i18next from 'i18next';
import en from '@/locales/en/groups.json';
import zh from '@/locales/zh-TW/groups.json';

const make = async (lng: string) => {
  const i = i18next.createInstance();
  await i.init({ lng, resources: { en: { groups: en }, 'zh-TW': { groups: zh } }, ns: ['groups'], defaultNS: 'groups' });
  return i;
};

it('pluralises member counts and keeps the bare header', async () => {
  const i = await make('en');
  expect(i.t('members', { count: 1 })).toBe('1 member');
  expect(i.t('members', { count: 3 })).toBe('3 members');
  expect(i.t('members')).toBe('Members');
  expect(i.t('mobile.failedCaveat', { count: 2 })).toBe("Leaves out 2 groups that didn't load");
});

it('zh-TW resolves the same keys', async () => {
  const i = await make('zh-TW');
  expect(i.t('members', { count: 3 })).toBe('3 位成員');
  expect(i.t('members')).toBe('成員');
  expect(i.t('mobile.failedCaveat', { count: 2 })).toContain('2');
});

it('no bundle uses v3 `_plural` keys (i18next v4 never reads them)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const root = path.resolve(__dirname, '../../locales');
  const offenders = fs.readdirSync(root).flatMap((lng) =>
    fs.readdirSync(path.join(root, lng))
      .filter((f) => f.endsWith('.json') && /"[^"]+_plural"\s*:/.test(fs.readFileSync(path.join(root, lng, f), 'utf8')))
      .map((f) => `${lng}/${f}`),
  );
  expect(offenders).toEqual([]);
});
