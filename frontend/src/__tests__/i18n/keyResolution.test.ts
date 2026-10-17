import fs from 'fs';
import path from 'path';

/**
 * Guards against the failure that shipped on /portfolio/add: `addHolding` was a
 * plain string in portfolio.json while the page called `addHolding.title`,
 * `addHolding.validation.*` and 41 other sub-keys. i18next cannot resolve a
 * sub-key of a string, so the page rendered raw key names to the user. Nothing
 * caught it — it type-checks, lints clean, and only shows up on screen.
 */

const SRC = path.join(__dirname, '..', '..');
const LOCALES = path.join(SRC, 'locales');
const LANGS = ['en', 'zh-TW'];

type Bundle = Record<string, unknown>;

function loadBundles(lang: string): Record<string, Bundle> {
  const dir = path.join(LOCALES, lang);
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        path.basename(f, '.json'),
        JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
      ])
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Walk a dotted path; returns the node or undefined. */
function nodeAt(bundle: Bundle | undefined, key: string): unknown {
  let node: unknown = bundle;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    node = (node as Bundle)[part];
  }
  return node;
}

/** Accepts i18next's _one/_other plural forms as a resolution. */
function resolves(bundle: Bundle | undefined, key: string): boolean {
  if (typeof nodeAt(bundle, key) === 'string') return true;
  return (
    typeof nodeAt(bundle, `${key}_one`) === 'string' ||
    typeof nodeAt(bundle, `${key}_other`) === 'string'
  );
}

// t('ns:some.key'  — optionally followed by a second argument
const CALL = /\bt\(\s*(['"])([\w.-]+:[\w.\-[\]]+)\1\s*(,\s*(['"]))?/g;

const bundles = Object.fromEntries(LANGS.map((l) => [l, loadBundles(l)]));
// hooks/ carries toast copy through t() too, so it needs the same guard
const files = walk(path.join(SRC, 'app')).concat(
  walk(path.join(SRC, 'components')),
  walk(path.join(SRC, 'hooks'))
);

describe('i18n keys resolve', () => {
  it.each(LANGS)('every namespaced t() key resolves in %s', (lang) => {
    const unresolved: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL)) {
        // a string-literal second argument is an explicit fallback, so a missing
        // key degrades to that text rather than rendering the raw key
        if (m[4]) continue;
        const [ns, key] = m[2].split(/:(.+)/);
        const bundle = bundles[lang][ns];
        if (!bundle) continue; // namespace not shipped in this bundle set
        if (!resolves(bundle, key)) {
          unresolved.push(`${ns}:${key}  (${path.relative(SRC, file)})`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });

  // The regex above only sees string-literal keys. These screens build their
  // <option> labels from a key array inside a template literal — so every
  // category shipped snake_case while goals.json was keyed camelCase, and half
  // the dropdown rendered "categories.emergency_fund" at the user.
  const OPTION_LISTS: [file: string, array: string, group: string][] = [
    ['components/goals/CreateGoalModal.tsx', 'CATEGORY_KEYS', 'categories'],
    ['components/goals/CreateGoalModal.tsx', 'PRIORITY_KEYS', 'priorities'],
    ['components/goals/EditGoalModal.tsx', 'CATEGORY_KEYS', 'categories'],
    ['components/goals/EditGoalModal.tsx', 'PRIORITY_KEYS', 'priorities'],
    ['components/goals/EditGoalModal.tsx', 'STATUS_KEYS', 'status'],
    ['app/goals/page.tsx', 'CATEGORY_FILTER_KEYS', 'categories'],
    ['app/goals/page.tsx', 'STATUS_FILTER_KEYS', 'status'],
  ];

  it.each(LANGS)('every goal option-list key resolves in %s', (lang) => {
    const unresolved: string[] = [];

    for (const [file, array, group] of OPTION_LISTS) {
      const src = fs.readFileSync(path.join(SRC, file), 'utf8');
      const literal = src.match(new RegExp(`const ${array} = \\[([^\\]]*)\\]`))?.[1];
      expect(literal).toBeDefined();
      const keys = [...literal!.matchAll(/'([\w-]+)'/g)].map((m) => `${group}.${m[1]}`);
      expect(keys.length).toBeGreaterThan(0);
      unresolved.push(
        ...keys.filter((k) => !resolves(bundles[lang].goals, k)).map((k) => `goals:${k}  (${file})`)
      );
    }

    expect(unresolved).toEqual([]);
  });

  /**
   * The same blind spot one level along: a filter panel that holds its labels
   * as `labelKey: 'ns:key'` in a module-level array and renders `t(opt.labelKey)`.
   * CALL above only sees literal keys inside `t(...)`, so the array is invisible
   * to it — a key that drifts from the bundle would render its own name on
   * screen with every test green. Matches any file using the convention, not
   * just the one that introduced it.
   */
  const LABEL_KEY = /\blabelKey:\s*(['"])([\w.-]+:[\w.-]+)\1/g;

  it.each(LANGS)('every labelKey in an option array resolves in %s', (lang) => {
    const unresolved: string[] = [];
    let seen = 0;

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(LABEL_KEY)) {
        seen += 1;
        const [ns, key] = m[2].split(/:(.+)/);
        const bundle = bundles[lang][ns];
        if (!bundle) continue;
        if (!resolves(bundle, key)) {
          unresolved.push(`${ns}:${key}  (${path.relative(SRC, file)})`);
        }
      }
    }

    // A regex that silently stops matching would pass this test forever.
    expect(seen).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  });

  it('no namespaced t() key points at an object instead of a string', () => {
    const objectKeys: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL)) {
        const [ns, key] = m[2].split(/:(.+)/);
        const node = nodeAt(bundles.en[ns], key);
        if (typeof node === 'object' && node !== null) {
          objectKeys.push(`${ns}:${key}  (${path.relative(SRC, file)})`);
        }
      }
    }
    expect(objectKeys).toEqual([]);
  });
});
