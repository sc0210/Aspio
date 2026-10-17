import {
  stripCurrencyPrefix,
  normalizeDate,
  parsePortfolioCSV,
  validatePortfolioImportData,
  CSV_EXPORT_HEADERS,
} from '@/utils/portfolioCsvUtils';

// ─── stripCurrencyPrefix ────────────────────────────────────────────────────

describe('stripCurrencyPrefix', () => {
  it('strips NT$ prefix', () => {
    expect(stripCurrencyPrefix('NT$114.04')).toBe('114.04');
  });

  it('strips plain $ prefix', () => {
    expect(stripCurrencyPrefix('$59.97')).toBe('59.97');
  });

  it('leaves plain numbers unchanged', () => {
    expect(stripCurrencyPrefix('114.04')).toBe('114.04');
  });

  it('strips leading minus and currency prefix', () => {
    // Net income values like -NT$9,921.48
    expect(stripCurrencyPrefix('-NT$9,921.48')).toBe('9921.48');
  });

  it('strips commas from large numbers', () => {
    expect(stripCurrencyPrefix('NT$61,500.00')).toBe('61500.00');
  });
});

// ─── normalizeDate ──────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('converts YYYY/MM/DD to YYYY-MM-DD', () => {
    expect(normalizeDate('2025/01/03')).toBe('2025-01-03');
  });

  it('leaves YYYY-MM-DD unchanged', () => {
    expect(normalizeDate('2025-01-03')).toBe('2025-01-03');
  });
});

// ─── CSV_EXPORT_HEADERS ─────────────────────────────────────────────────────

describe('CSV_EXPORT_HEADERS', () => {
  it('has exactly 7 columns in the correct order', () => {
    expect(CSV_EXPORT_HEADERS).toEqual([
      'Date', 'Type', 'StockID', 'Currency', 'Shares', 'Price per shares', 'Net income',
    ]);
  });
});

// ─── parsePortfolioCSV ──────────────────────────────────────────────────────

describe('parsePortfolioCSV — new trade-log format', () => {
  const makeCSV = (rows: string[]) =>
    ['Date,Type,StockID,Currency,Shares,Price per shares,Net income', ...rows].join('\n');

  it('parses a single buy row correctly', () => {
    const csv = makeCSV(['2025/01/03,買入,0050,TWD,87,114.04,-9921.48']);
    const [row] = parsePortfolioCSV(csv);
    expect(row.symbol).toBe('0050');
    expect(row.purchaseDate).toBe('2025-01-03');
    expect(row.currency).toBe('TWD');
    expect(row.exchange).toBe('TWSE');
    expect(row.quantity).toBe(87);
    expect(row.averageCost).toBeCloseTo(114.04);
  });

  it('sets name equal to symbol by default', () => {
    const csv = makeCSV(['2025/01/03,買入,VT,USD,50,114.95,-5747.5']);
    const [row] = parsePortfolioCSV(csv);
    expect(row.name).toBe('VT');
  });

  it('derives exchange TWSE for TWD currency', () => {
    const csv = makeCSV(['2025/01/03,買入,0050,TWD,100,61.5,-6150']);
    expect(parsePortfolioCSV(csv)[0].exchange).toBe('TWSE');
  });

  it('derives exchange US for non-TWD currency', () => {
    const csv = makeCSV(['2025/01/03,買入,VT,USD,10,114.95,-1149.5']);
    expect(parsePortfolioCSV(csv)[0].exchange).toBe('US');
  });

  it('skips 賣出 (sell) rows', () => {
    const csv = makeCSV([
      '2025/01/03,買入,0050,TWD,87,114.04,-9921.48',
      '2025/06/01,賣出,0050,TWD,50,130.00,6500',
    ]);
    const rows = parsePortfolioCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('0050');
  });

  it('skips "sell" rows (English)', () => {
    const csv = makeCSV([
      '2025/01/03,Buy,VT,USD,10,114.95,-1149.5',
      '2025/06/01,Sell,VT,USD,5,130.00,650',
    ]);
    expect(parsePortfolioCSV(csv)).toHaveLength(1);
  });

  it('handles prices with NT$ prefix from older exports', () => {
    const csv = makeCSV(['2025/01/03,買入,0050,TWD,87,NT$114.04,-NT$9921.48']);
    const [row] = parsePortfolioCSV(csv);
    expect(row.averageCost).toBeCloseTo(114.04);
  });

  it('strips UTF-8 BOM from start of file', () => {
    const csv = '﻿' + makeCSV(['2025/01/03,買入,0050,TWD,87,114.04,-9921.48']);
    expect(() => parsePortfolioCSV(csv)).not.toThrow();
    expect(parsePortfolioCSV(csv)).toHaveLength(1);
  });

  it('parses multiple rows independently', () => {
    const csv = makeCSV([
      '2025/01/03,買入,006208,TWD,87,114.04,-9921.48',
      '2025/08/24,買入,VT,USD,50.699,114.95,-5827.85',
      '2025/08/24,買入,VGIT,USD,15,59.97,-899.55',
    ]);
    const rows = parsePortfolioCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0].symbol).toBe('006208');
    expect(rows[1].symbol).toBe('VT');
    expect(rows[2].symbol).toBe('VGIT');
  });

  it('throws when CSV has no data rows', () => {
    expect(() => parsePortfolioCSV('Date,Type,StockID,Currency,Shares,Price per shares,Net income')).toThrow();
  });
});

describe('parsePortfolioCSV — legacy snapshot format', () => {
  const makeCSV = (rows: string[]) =>
    ['Symbol,Name,Type,Quantity,Average Cost,Currency,Exchange,Sector,Purchase Date', ...rows].join('\n');

  it('parses legacy format correctly', () => {
    const csv = makeCSV(['0050,元大台灣50,etf,1000,61.50,TWD,TWSE,Diversified,2024-01-15']);
    const [row] = parsePortfolioCSV(csv);
    expect(row.symbol).toBe('0050');
    expect(row.name).toBe('元大台灣50');
    expect(row.type).toBe('etf');
    expect(row.quantity).toBe(1000);
    expect(row.averageCost).toBeCloseTo(61.5);
    expect(row.exchange).toBe('TWSE');
    expect(row.purchaseDate).toBe('2024-01-15');
  });
});

// ─── validatePortfolioImportData ────────────────────────────────────────────

describe('validatePortfolioImportData', () => {
  const baseRow = {
    symbol: '0050',
    name: '0050',
    type: 'etf',
    currency: 'TWD',
    exchange: 'TWSE',
    quantity: 1000,
    averageCost: 61.5,
    purchaseDate: '2025-01-15',
  };

  it('accepts a fully valid row', () => {
    const { valid, errors } = validatePortfolioImportData([baseRow]);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });

  it('fills default name from symbol when name is missing', () => {
    const row = { ...baseRow, name: '' };
    const { valid } = validatePortfolioImportData([row]);
    expect(valid[0].name).toBe('0050');
  });

  it('fills default type "stock" when missing', () => {
    const row = { ...baseRow, type: '' };
    const { valid } = validatePortfolioImportData([row]);
    expect(valid[0].type).toBe('stock');
  });

  it('fills default exchange TWSE for TWD currency', () => {
    const row = { ...baseRow, exchange: '' };
    const { valid } = validatePortfolioImportData([row]);
    expect(valid[0].exchange).toBe('TWSE');
  });

  it('fills default exchange US for non-TWD currency', () => {
    const row = { ...baseRow, exchange: '', currency: 'USD' };
    const { valid } = validatePortfolioImportData([row]);
    expect(valid[0].exchange).toBe('US');
  });

  it('rejects row with missing symbol', () => {
    const { valid, errors } = validatePortfolioImportData([{ ...baseRow, symbol: '' }]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toContain('Symbol is required');
  });

  it('rejects row with zero shares', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, quantity: 0 }]);
    expect(errors[0]).toContain('Shares must be a positive number');
  });

  it('rejects row with negative shares', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, quantity: -5 }]);
    expect(errors[0]).toContain('Shares must be a positive number');
  });

  it('rejects row with zero price', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, averageCost: 0 }]);
    expect(errors[0]).toContain('Price per shares must be a positive number');
  });

  it('rejects row with missing currency', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, currency: '' }]);
    expect(errors[0]).toContain('Currency is required');
  });

  it('rejects row with invalid asset type', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, type: 'banana' }]);
    expect(errors[0]).toContain('Invalid type');
  });

  it('rejects row with bad date format', () => {
    const { errors } = validatePortfolioImportData([{ ...baseRow, purchaseDate: 'not-a-date' }]);
    expect(errors[0]).toContain('Invalid date format');
  });

  it('reports correct row numbers (1-based, header is row 1)', () => {
    const { errors } = validatePortfolioImportData([
      baseRow,
      { ...baseRow, symbol: '' },   // row 3
    ]);
    expect(errors[0]).toContain('Row 3');
  });

  it('collects errors from multiple rows independently', () => {
    const { valid, errors } = validatePortfolioImportData([
      { ...baseRow, symbol: '' },
      baseRow,
      { ...baseRow, quantity: 0 },
    ]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it('accepts all valid asset types', () => {
    const types = ['stock', 'etf', 'crypto', 'cryptocurrency', 'bond', 'mutual_fund', 'reit', 'commodity', 'cash'];
    types.forEach(type => {
      const { errors } = validatePortfolioImportData([{ ...baseRow, type }]);
      expect(errors).toHaveLength(0);
    });
  });
});
