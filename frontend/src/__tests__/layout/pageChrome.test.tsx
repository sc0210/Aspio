/**
 * The two halves of a page's chrome, and the rule that they never overlap.
 *
 * `DashboardLayout` names the page in the desktop top bar via `PageTitle`; the
 * page names itself on phones via `PageHeader`. Both halves had holes. /housing
 * and /lifecycle reached the sidebar without ever reaching `PageTitle`'s
 * hand-kept route list, so their desktop top bar was empty; /rebalancing had
 * the same gap with no in-page header to fall back on above 768px, so it was
 * anonymous on every desktop. Nothing failed — a missing title renders as
 * nothing at all, which looks like a design choice.
 *
 * Both suites here are route-complete rather than example-based: they walk
 * app/ for the real pages, so a page added tomorrow is covered without anyone
 * remembering to add it.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import zhTW from '@/locales/zh-TW/common.json';

const APP = path.join(__dirname, '../../app');
const SRC = path.join(__dirname, '../..');

let pathname = '/dashboard';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

// Imported after the mock so PageTitle picks it up.
import { PageTitle } from '@/components/layout/PageTitle';

/**
 * Pages reached without the dashboard chrome: signed-out flows, the public
 * legal pages, the LIFF webview inside LINE, and the marketing root. None of
 * them render `DashboardLayout`, so none of them has a top bar to fill.
 */
const NO_CHROME = [/^\/auth\//, /^\/privacy$/, /^\/terms$/, /^\/liff$/, /^\/link-line$/, /^\/$/];

const SAMPLE_IDS: Record<string, string> = {
    '[id]': '42',
    '[symbol]': '0050',
};

/** Every route that has a page, with dynamic segments filled in. */
function routes(dir = APP, prefix = ''): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...routes(full, `${prefix}/${SAMPLE_IDS[entry.name] ?? entry.name}`));
        } else if (entry.name === 'page.tsx') {
            found.push(prefix || '/');
        }
    }
    return found;
}

const fileFor = (route: string) =>
    path.join(
        APP,
        route
            .split('/')
            .map((seg) => Object.entries(SAMPLE_IDS).find(([, v]) => v === seg)?.[0] ?? seg)
            .join('/'),
        'page.tsx',
    );

/** Routes that mount the dashboard chrome — the ones with a top bar to fill. */
const CHROMED = routes()
    .filter((route) => !NO_CHROME.some((skip) => skip.test(route)))
    .filter((route) => fs.readFileSync(fileFor(route), 'utf8').includes('DashboardLayout'))
    .sort();

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: { en: { common: en }, 'zh-TW': { common: zhTW } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

describe('every page is named in the desktop top bar', () => {
    it('finds the app’s routes', () => {
        // A guard on the walker itself: if it silently returned nothing, every
        // case below would vacuously pass.
        expect(CHROMED.length).toBeGreaterThan(15);
        expect(CHROMED).toContain('/housing');
        expect(CHROMED).toContain('/rebalancing');
    });

    it.each(CHROMED)('%s', (route) => {
        pathname = route;
        render(
            <I18nextProvider i18n={i18n}>
                <PageTitle />
            </I18nextProvider>,
        );

        const heading = screen.queryByRole('heading', { level: 1 });
        expect(heading).not.toBeNull();

        // A key that did not resolve renders as its own dotted name. That was
        // real: navigation.trend, .holdings and six siblings were in no bundle,
        // and PageTitle carried a table of English fallbacks to paper over it —
        // which meant a Chinese reader got "Add Transaction" in English.
        expect(heading!.textContent!.trim()).not.toBe('');
        expect(heading!.textContent).not.toMatch(/^navigation\./);
    });
});

const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * Whether the element on `i` sits inside something the desktop hides.
 *
 * The marker is rarely on the `<h1>` itself — /portfolio/trend puts it ten
 * lines up on the app-bar row that wraps the title and its buttons. So walk
 * the ancestor chain, which in formatted JSX is the run of lines above with
 * strictly decreasing indentation.
 */
function hiddenOnDesktop(lines: string[], i: number): boolean {
    if (lines[i].includes('md:hidden')) return true;

    let indent = indentOf(lines[i]);
    for (let j = i - 1; j >= 0 && indent > 0; j--) {
        if (!lines[j].trim()) continue;
        const outer = indentOf(lines[j]);
        if (outer < indent) {
            if (lines[j].includes('md:hidden')) return true;
            indent = outer;
        }
    }
    return false;
}

describe('a page never draws a title the top bar is already drawing', () => {
    /**
     * Only pages that mount `DashboardLayout` have a top bar to collide with.
     * /transactions/scan renders its own shell, so its `<h1>` is the only name
     * that page has and must stay visible at every width.
     */
    const PAGES = routes()
        .filter((route) => !NO_CHROME.some((skip) => skip.test(route)))
        .map((route) => {
            const dir = route
                .split('/')
                .map((seg) => Object.entries(SAMPLE_IDS).find(([, v]) => v === seg)?.[0] ?? seg)
                .join('/');
            return [route, path.join(APP, dir, 'page.tsx')] as const;
        })
        .filter(([, file]) => fs.readFileSync(file, 'utf8').includes('DashboardLayout'));

    it('finds the chromed pages', () => {
        expect(PAGES.length).toBeGreaterThan(15);
    });

    it.each(PAGES)('%s', (_route, file) => {
        const lines = fs.readFileSync(file, 'utf8').split('\n');

        // `PageHeader` is md:hidden by construction, so a page using it is fine.
        // A hand-written <h1> has to be hidden by something above it.
        const exposed = lines
            .map((text, i) => ({ line: i + 1, text, i }))
            .filter(({ text, i }) => text.includes('<h1') && !hiddenOnDesktop(lines, i))
            .map(({ line, text }) => `${path.relative(SRC, file)}:${line}  ${text.trim().slice(0, 60)}`);

        expect(exposed).toEqual([]);
    });
});
