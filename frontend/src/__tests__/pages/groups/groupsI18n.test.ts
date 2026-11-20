/**
 * i18n regression guard for the `groups` namespace.
 *
 * Protects against the class of bug where a page references a translation key the
 * locale files don't provide (users then see raw "history" / "addExpense" strings
 * instead of copy). Asserts:
 *   1. en and zh-TW are in EXACT key-parity with each other.
 *   2. the namespace exposes its documented 85 keys.
 *   3. every key referenced at runtime by BOTH groups pages exists in BOTH locale
 *      files.
 *
 * JSON is read off disk and JSON.parse'd (rather than `import x from '*.json'`,
 * which is unreliable under this project's next/jest transform) — this also
 * keeps the file free of `require()`, which the repo's lint config forbids.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../'); // -> frontend/src
const LIST_PAGE = path.join(ROOT, 'app/groups/page.tsx');
const DETAIL_PAGE = path.join(ROOT, 'app/groups/[id]/page.tsx');

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const en = readJson('locales/en/groups.json');
const zh = readJson('locales/zh-TW/groups.json');

type Json = Record<string, unknown>;

function flatten(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v as Json, key) : [key];
  });
}
function has(obj: Json, dotted: string): boolean {
  return (
    dotted.split('.').reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Json)[part] : undefined),
      obj,
    ) !== undefined
  );
}
/** Scrape t('foo') / t("foo.bar") references, normalising the "groups:" prefix. */
function referencedKeys(file: string): Set<string> {
  const code = fs.readFileSync(file, 'utf8');
  const re = /\bt\(\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let key = m[1];
    if (key.startsWith('groups:')) key = key.slice('groups:'.length);
    if (key.includes(':')) continue; // belongs to another namespace (e.g. common:)
    out.add(key);
  }
  return out;
}

describe('groups i18n namespace', () => {
  it('en and zh-TW have identical key sets', () => {
    const enKeys = flatten(en).sort();
    const zhKeys = flatten(zh).sort();
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
    expect({ missingInZh, missingInEn }).toEqual({ missingInZh: [], missingInEn: [] });
    expect(zhKeys).toEqual(enKeys);
  });

  it('exposes the documented 85 keys', () => {
    expect(flatten(en).length).toBe(85);
    expect(flatten(zh).length).toBe(85);
  });

  it('contains every key the list page references (en + zh-TW)', () => {
    const refs = [...referencedKeys(LIST_PAGE)];
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((k) => !has(en, k))).toEqual([]);
    expect(refs.filter((k) => !has(zh, k))).toEqual([]);
  });

  it('contains every key the detail page references (en + zh-TW)', () => {
    const refs = [...referencedKeys(DETAIL_PAGE)];
    // The detail page is key-heavy (form modal, settle modal, errors namespace).
    expect(refs.length).toBeGreaterThan(40);
    expect(refs.filter((k) => !has(en, k))).toEqual([]);
    expect(refs.filter((k) => !has(zh, k))).toEqual([]);
  });
});
