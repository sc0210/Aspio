import { csvCell, guardCell, unguardCell } from '@/utils/csvCell';

describe('csvCell', () => {
  it.each(['=SUM(A1)', '+1', '-50% sale', '@me', '\tx', '\rx', '  =x', '＝SUM(A1)', '＋1', '－5', '＠me', '　＝x', "'=x"])(
    'guards formula-like text %j',
    (text) => expect(guardCell(text)).toBe(`'${text}`),
  );

  it.each(['plain', 'a=b', "'quoted'", '   ', ''])('leaves %j alone', (text) => expect(guardCell(text)).toBe(text));

  it.each(['-50% sale', '=x', "'=x", "''+y", "'quoted'", 'plain', '＝x', `${"'".repeat(5000)}=x`])(
    'round-trips %j through guard and unguard',
    (text) => expect(unguardCell(guardCell(text))).toBe(text),
  );

  it('quotes delimiters and leaves numbers unguarded', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1,2')).toBe(`"'=1,2"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-1234.50')).toBe('-1234.50');
    expect(csvCell('-50% sale')).toBe("'-50% sale");
    expect(csvCell('  lunch ')).toBe('"  lunch "');
  });
});
