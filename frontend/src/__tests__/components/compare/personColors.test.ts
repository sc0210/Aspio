import { PERSON_COLORS, personColors } from '@/components/compare/personColors';

describe('personColors', () => {
  it('gives you the first colour and partners the next, in user-id order', () => {
    const colors = personColors(['u-b', 'me', 'u-a'], 'me');
    expect(colors.get('me')).toBe(PERSON_COLORS[0]);
    expect(colors.get('u-a')).toBe(PERSON_COLORS[1]);
    expect(colors.get('u-b')).toBe(PERSON_COLORS[2]);
  });

  it('colours a partner the same with or without you in the list', () => {
    // The members row has no "you"; Compare does. 小明 must match in both.
    expect(personColors(['u-a', 'u-b']).get('u-b')).toBe(personColors(['me', 'u-a', 'u-b'], 'me').get('u-b'));
  });

  it('never gives a partner your colour, however many there are', () => {
    const partners = Array.from({ length: 9 }, (_, i) => `u-${i}`);
    const colors = personColors(['me', ...partners], 'me');
    for (const id of partners) expect(colors.get(id)).not.toBe(PERSON_COLORS[0]);
    // The first four partners are all told apart.
    expect(new Set(partners.slice(0, 4).map((id) => colors.get(id))).size).toBe(4);
  });
});
