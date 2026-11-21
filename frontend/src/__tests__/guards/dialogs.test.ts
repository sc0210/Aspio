/**
 * New dialogs use `components/ui/Modal`.
 *
 * Dialogs were built three ways: Headless UI's Dialog directly, the `useDialog`
 * hook over hand-written markup, and `<Modal>`. They already share one dialog
 * stack (Escape and Tab go to the innermost), so they behave alike; they do not
 * look alike, and each new one picked a pattern at random. The files below are
 * the ones that predate this rule. Move one to `<Modal>` (or `ConfirmDialog`)
 * and delete its line; never add a line.
 */
import fs from 'fs';
import path from 'path';

const LEGACY = new Set([
  'components/compare/AddPeerModal.tsx',
  'components/dashboard/FinancialTermsHelp.tsx',
  'components/goals/AchievementDetailModal.tsx',
  'components/goals/ContributeModal.tsx',
  'components/goals/CreateGoalModal.tsx',
  'components/goals/EditGoalModal.tsx',
  'components/layout/CommandPalette.tsx',
  'components/layout/MobileBottomNav.tsx',
  'components/loans/AddLoanModal.tsx',
  'components/loans/EditLoanModal.tsx',
  'components/loans/EditPaymentModal.tsx',
  'components/loans/RecordPaymentModal.tsx',
  'components/portfolio/BuyHoldingModal.tsx',
  'components/portfolio/HoldingDetailModal.tsx',
  'components/portfolio/ImportExportModal.tsx',
  'components/portfolio/LotSelectionModal.tsx',
  'components/portfolio/SellHoldingModal.tsx',
  'components/portfolio/WalletManagementModal.tsx',
  'components/savings/AmendSplitModal.tsx',
  'components/savings/CreateGoalModal.tsx',
  'components/savings/GoalHistoryModal.tsx',
  'components/savings/NewSplitModal.tsx',
  'components/savings/SettleUpModal.tsx',
  'components/transactions/SplitExpenseModal.tsx',
  'components/transactions/TransactionImportExportModal.tsx',
  'components/transactions/TransactionList.tsx',
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
  expect(own.filter((f) => !LEGACY.has(f))).toEqual([]);
  // A file moved to <Modal> must leave the list, so the backlog only shrinks.
  expect([...LEGACY].filter((f) => !own.includes(f))).toEqual([]);
});
