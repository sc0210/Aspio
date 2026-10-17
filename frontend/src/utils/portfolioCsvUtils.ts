/**
 * Utility functions for portfolio CSV/XLSX import/export.
 * Keeping these separate from the modal makes them unit-testable.
 */

export const CSV_EXPORT_HEADERS = [
  'Date', 'Type', 'StockID', 'Currency', 'Shares', 'Price per shares', 'Net income',
] as const;

interface ParsedCsvRow {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  exchange: string;
  quantity: number;
  averageCost: number;
  purchaseDate?: string;
  transactionType?: string;
}

export interface ValidatedHolding extends ParsedCsvRow {
  name: string;
  type: string;
  exchange: string;
}

/** Strip currency prefix (NT$, $, ¥ …) and commas from a value string. */
export function stripCurrencyPrefix(value: string): string {
  return value.replace(/^-?\s*[A-Z]*\$/, '').replace(/,/g, '').trim();
}

/** Normalise YYYY/MM/DD → YYYY-MM-DD (ISO). Already ISO strings pass through unchanged. */
export function normalizeDate(value: string): string {
  return value.replace(/\//g, '-');
}

/**
 * Parse a portfolio CSV text.
 * Supports the new trade-log format (Date / Type / StockID / Currency / Shares / Price per shares / Net income)
 * and the legacy snapshot format (Symbol / Name / Type / Quantity / Average Cost / Currency / Exchange …).
 * Sell rows (賣出 / sell) are skipped — holdings are buy-only.
 */
export function parsePortfolioCSV(text: string): ParsedCsvRow[] {
  // Strip UTF-8 BOM if present
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split('\n').filter(line => line.trim());
  if (lines.length < 2) throw new Error('CSV file is empty or has no data rows');

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const isNewFormat = headers.includes('stockid') || headers.includes('price per shares');
  const rows: ParsedCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const row: Partial<ParsedCsvRow> & { transactionType?: string } = {};

    headers.forEach((header, idx) => {
      const value = values[idx] ?? '';

      if (isNewFormat) {
        switch (header) {
          case 'date':
            row.purchaseDate = normalizeDate(value) || undefined;
            break;
          case 'type':
            row.transactionType = value;
            break;
          case 'stockid':
            row.symbol = value.toUpperCase();
            row.name = value.toUpperCase();
            break;
          case 'currency':
            row.currency = value.toUpperCase();
            row.exchange = value === 'TWD' ? 'TWSE' : 'US';
            break;
          case 'shares':
            row.quantity = parseFloat(value);
            break;
          case 'price per shares':
            row.averageCost = parseFloat(stripCurrencyPrefix(value));
            break;
          // Net income is derived — ignored on import
        }
      } else {
        // Legacy snapshot format
        switch (header) {
          case 'symbol':       row.symbol = value.toUpperCase(); break;
          case 'name':         row.name = value; break;
          case 'type':         row.type = value.toLowerCase(); break;
          case 'quantity':     row.quantity = parseFloat(value); break;
          case 'average cost':
          case 'averagecost':  row.averageCost = parseFloat(value); break;
          case 'currency':     row.currency = value.toUpperCase(); break;
          case 'exchange':     row.exchange = value; break;
          case 'purchase date':
          case 'purchasedate': row.purchaseDate = value || undefined; break;
        }
      }
    });

    if (isNewFormat) {
      if (/賣出|sell/i.test(row.transactionType ?? '')) continue;
      if (!row.type) row.type = 'stock';
    }

    rows.push(row as ParsedCsvRow);
  }

  return rows;
}

const VALID_TYPES = [
  'stock', 'etf', 'crypto', 'cryptocurrency',
  'bond', 'mutual_fund', 'reit', 'commodity', 'cash', 'lending',
];

/**
 * Validate parsed CSV rows.
 * Fills in optional defaults (name, type, exchange) that the new format omits.
 * Returns { valid, errors } — errors reference the original 1-based row numbers.
 */
export function validatePortfolioImportData(
  data: ParsedCsvRow[],
): { valid: ValidatedHolding[]; errors: string[] } {
  const valid: ValidatedHolding[] = [];
  const errors: string[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2; // +2: row 1 is header

    if (!row.symbol) {
      errors.push(`Row ${rowNum}: StockID / Symbol is required`);
      return;
    }

    // Fill defaults for fields the new format omits
    const name = row.name || row.symbol;
    const type = (row.type || 'stock').toLowerCase();
    const exchange = row.exchange || (row.currency === 'TWD' ? 'TWSE' : 'US');

    if (isNaN(row.quantity) || row.quantity <= 0) {
      errors.push(`Row ${rowNum}: Shares must be a positive number`);
      return;
    }
    if (isNaN(row.averageCost) || row.averageCost <= 0) {
      errors.push(`Row ${rowNum}: Price per shares must be a positive number`);
      return;
    }
    if (!row.currency) {
      errors.push(`Row ${rowNum}: Currency is required`);
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      errors.push(`Row ${rowNum}: Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`);
      return;
    }
    if (row.purchaseDate) {
      const d = new Date(row.purchaseDate);
      if (isNaN(d.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date format. Use YYYY/MM/DD or YYYY-MM-DD`);
        return;
      }
    }

    valid.push({ ...row, name, type, exchange });
  });

  return { valid, errors };
}

