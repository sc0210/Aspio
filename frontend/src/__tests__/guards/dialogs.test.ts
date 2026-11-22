/**
 * Dialogs use `components/ui/Modal` (or `ConfirmDialog`).
 *
 * They were built three ways: Headless UI's Dialog directly, the `useDialog`
 * hook over hand-written markup, and `<Modal>`. All three already shared one
 * dialog stack, so they behaved alike, but they did not look alike: four header
 * sizes, three backdrops, close buttons from 24px to 44px. All 24 now use
 * <Modal>. Only the two overlays below keep their own shape.
 */
import fs from 'fs';
import path from 'path';

/**
 * Overlays that are not dialog-shaped, so <Modal> does not fit them. Each keeps
 * the shared behaviour through useDialog or Headless UI.
 */
const OWN_SHAPE = new Map([
  // A search box pinned near the top, results under it: no title bar, no body.
  ['components/layout/CommandPalette.tsx', 'command palette'],
  // The phone tab bar's More sheet: slides up from the tab bar it belongs to.
  ['components/layout/MobileBottomNav.tsx', 'bottom sheet'],
]);

const SRC = path.join(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Not modals: a dropdown and a tour step carry role="dialog" but block nothing. */
const NOT_MODALS = new Set(['components/layout/NotificationBell.tsx', 'components/tour/ProductTour.tsx']);

function buildsItsOwnDialog(source: string): boolean {
  const headless = /from ['"]@headlessui\/react['"]/.test(source) && /<Dialog\b|\bDialogPanel\b/.test(source);
  const handMade = /role=["']dialog["']|aria-modal/.test(source);
  return headless || handMade || /\buseDialog\(/.test(source);
}

it('builds no new dialog outside <Modal>', () => {
  const own = [...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'components'))]
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((f) => f !== 'components/ui/Modal.tsx' && f !== 'components/ui/ConfirmDialog.tsx' && !NOT_MODALS.has(f))
    .filter((f) => buildsItsOwnDialog(fs.readFileSync(path.join(SRC, f), 'utf8')));
  expect(own.filter((f) => !OWN_SHAPE.has(f))).toEqual([]);
  // An exception that no longer builds its own overlay leaves the list.
  expect([...OWN_SHAPE.keys()].filter((f) => !own.includes(f))).toEqual([]);
});
