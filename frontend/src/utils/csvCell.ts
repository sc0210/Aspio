/**
 * CSV cells a spreadsheet can't run, matching the backend's export guard
 * (`_safe_cell` in transactions/attachment_service.py).
 *
 * Text starting with = + - @ (or the full-width ＝ ＋ － ＠ a CJK spreadsheet may read the
 * same, even after spaces) or with a tab or carriage return is a formula to Excel. A
 * leading apostrophe makes it text. Text that already has apostrophes before one of
 * those gets one more, so `unguardCell` on import gives back exactly what was written.
 */
const FORMULA_START = /^(?:[\t\r]|[ 　]*[=+\-@＝＋－＠])/;

function needsGuard(text: string): boolean {
  return FORMULA_START.test(text.replace(/^'+/, ''));
}

export function guardCell(text: string): string {
  return needsGuard(text) ? `'${text}` : text;
}

/** Undo `guardCell` on import. Only an apostrophe it could have added is removed. */
export function unguardCell(text: string): string {
  return text.startsWith("'") && needsGuard(text.slice(1)) ? text.slice(1) : text;
}

/**
 * One CSV field: text guarded, then quoted when it holds a delimiter, quote or line break,
 * or starts or ends with a space a reader would trim. A plain number stays a number even
 * as a string (`toFixed`, a Decimal from the API): "-12.50" is not a formula.
 */
export function csvCell(value: string | number): string {
  const text = typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value) ? guardCell(value) : String(value);
  return /[",\n\r]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
