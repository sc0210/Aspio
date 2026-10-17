/**
 * Both bundles have to declare the same keys.
 *
 * Every string added this way is added twice by hand, in two files, and the
 * failure is silent. `i18n.ts` sets `fallbackLng: 'en'`, so a key missing from
 * zh-TW does not throw and does not render its own name — it renders the
 * English sentence at a reader who asked for Chinese. That is the same defect
 * this branch has been fixing from the other side, and it is even quieter,
 * because the screen still looks finished. (Only a key missing from *both*
 * bundles renders as `dashboard:rebalancing.plan.totalBuy`.)
 *
 * It compares structure, not text — a key whose translation is still the
 * English wording is a different problem, and not one a test can see.
 */

import fs from 'fs';
import path from 'path';

const LOCALES = path.join(__dirname, '../../locales');
const BASE = 'en';
const OTHER = 'zh-TW';

const flatten = (value: unknown, prefix = ''): string[] => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [prefix];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
    );
};

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** The cardinal categories a language actually has: en → one, other; zh-TW → other. */
const categoriesOf = (locale: string): string[] =>
    new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

/**
 * Which bases are plurals, decided from English and only from English.
 *
 * A name ending in `_other` is not evidence of one. `growthForecast.group_other`
 * is the "Other" spending category, sibling to `group_food` and `group_housing`,
 * and stripping its suffix would compare it as `growthForecast.group` — quietly
 * excusing a zh-TW bundle that had written `group_one` instead. English has two
 * cardinal categories, so a real plural here is always the `_one`/`_other` pair,
 * and the `_one` is what identifies it. Everything else is compared under its
 * literal name.
 */
const pluralBases = (englishKeys: string[]): Set<string> =>
    new Set(englishKeys.filter((key) => key.endsWith('_one')).map((key) => key.slice(0, -'_one'.length)));

const baseOf = (key: string): string => key.replace(PLURAL_SUFFIX, '');

/** Keys outside every plural group, compared by their literal name. */
const plainKeys = (keys: string[], bases: Set<string>): string[] =>
    keys.filter((key) => !bases.has(baseOf(key)));

/** Plural groups this locale declares at all — by base name, however it spelled the members. */
const declaredGroups = (keys: string[], bases: Set<string>): string[] =>
    keys.map(baseOf).filter((base) => bases.has(base));

const missing = (from: string[], present: string[]): string[] => {
    const has = new Set(present);
    return [...new Set(from.filter((key) => !has.has(key)))].sort();
};

/** Which of `keys` each language is missing, plural groups counted once by base. */
export const compareKeys = (englishKeys: string[], otherKeys: string[]) => {
    const bases = pluralBases(englishKeys);
    const en = [...plainKeys(englishKeys, bases), ...declaredGroups(englishKeys, bases)];
    const other = [...plainKeys(otherKeys, bases), ...declaredGroups(otherKeys, bases)];

    return {
        missingFromZhTW: missing(en, other),
        missingFromEn: missing(other, en),
    };
};

/**
 * Plural forms the locale needs and cannot resolve.
 *
 * i18next looks for `base_<category>` and falls back to a bare `base`, so either
 * spelling covers a category — but nothing covers a group that carries only the
 * categories some *other* language needed. A zh-TW `holding_one` with no
 * `holding_other` is unreachable for every count there is, and falls through to
 * English.
 */
export const pluralGaps = (keys: string[], englishKeys: string[], locale: string): string[] => {
    const bases = pluralBases(englishKeys);
    const declared = new Set(keys);
    const present = new Set(declaredGroups(keys, bases));

    return [...bases]
        .filter((base) => present.has(base))
        .flatMap((base) =>
            categoriesOf(locale)
                .filter((category) => !declared.has(`${base}_${category}`) && !declared.has(base))
                .map((category) => `${base}_${category}`),
        )
        .sort();
};

const read = (locale: string, file: string): string[] =>
    flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, locale, file), 'utf8')));

const namespaces = fs
    .readdirSync(path.join(LOCALES, BASE))
    .filter((file) => file.endsWith('.json'));

describe('locale bundles', () => {
    it('ships the same namespaces in both languages', () => {
        expect(fs.readdirSync(path.join(LOCALES, OTHER)).filter((f) => f.endsWith('.json')).sort())
            .toEqual(namespaces.sort());
    });

    it.each(namespaces)('%s declares the same keys in both languages', (file) => {
        expect(compareKeys(read(BASE, file), read(OTHER, file)))
            .toEqual({ missingFromZhTW: [], missingFromEn: [] });
    });

    it.each(namespaces)('%s carries every plural form each language needs', (file) => {
        const english = read(BASE, file);

        expect({
            [BASE]: pluralGaps(english, english, BASE),
            [OTHER]: pluralGaps(read(OTHER, file), english, OTHER),
        }).toEqual({ [BASE]: [], [OTHER]: [] });
    });
});

/**
 * The comparison's own tests. The rules above are what the bundles are held to,
 * so the cases that must fail are worth stating outright rather than inferring
 * from a bundle that happens to be clean today.
 */
describe('the comparison', () => {
    const EN = ['holding_one', 'holding_other', 'group_other', 'title'];

    it('accepts a zh-TW plural written with only the form Chinese has', () => {
        expect(compareKeys(EN, ['holding_other', 'group_other', 'title']))
            .toEqual({ missingFromZhTW: [], missingFromEn: [] });
        expect(pluralGaps(['holding_other', 'group_other', 'title'], EN, OTHER)).toEqual([]);
    });

    it('accepts a single bare form standing in for every category', () => {
        expect(pluralGaps(['holding', 'group_other', 'title'], EN, OTHER)).toEqual([]);
    });

    it('reports a zh-TW plural that carries only _one', () => {
        // Renders "3 items" at a Chinese reader: `holding_other` is what zh-TW
        // resolves for every count, and `_one` is not a form it ever reaches.
        expect(pluralGaps(['holding_one', 'group_other', 'title'], EN, OTHER))
            .toEqual(['holding_other']);
    });

    it('reports an English plural missing half its pair', () => {
        expect(pluralGaps(['holding_one', 'title'], ['holding_one', 'title'], BASE))
            .toEqual(['holding_other']);
    });

    it('does not mistake a word ending in _other for a plural', () => {
        // `group_other` is the "Other" spending category. Were it stripped to
        // `group`, this zh-TW typo would compare equal and ship.
        expect(compareKeys(EN, ['holding_other', 'group_one', 'title']))
            .toEqual({ missingFromZhTW: ['group_other'], missingFromEn: ['group_one'] });
    });

    it('reports a plural group absent from zh-TW once, by its base', () => {
        expect(compareKeys(EN, ['group_other', 'title']))
            .toEqual({ missingFromZhTW: ['holding'], missingFromEn: [] });
    });
});
