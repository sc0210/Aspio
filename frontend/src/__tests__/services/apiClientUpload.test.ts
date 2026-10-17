/**
 * Tests for ApiClient.upload() and the two transactionService upload methods.
 */

import { ApiClient } from '@/lib/api-client';
import { getSession } from 'next-auth/react';

const mockGetSession = getSession as jest.Mock;
const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeFile(name = 'data.csv', type = 'text/csv'): File {
  return new File(['col1,col2\nval1,val2'], name, { type });
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

// ─── ApiClient.upload ─────────────────────────────────────────────────────────

describe('ApiClient.upload()', () => {
  let client: ApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    client = new ApiClient();
  });

  it('sends a POST with FormData containing the file', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { imported: 3, failed: 0, errors: [] }));
    const file = makeFile();

    await client.upload('/transactions/upload-import', file);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('appends extra fields to the FormData', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { imported: 1, failed: 0, errors: [] }));
    const file = makeFile();

    await client.upload('/transactions/upload-import', file, { skip_duplicates: 'true' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('skip_duplicates')).toBe('true');
  });

  it('attaches Authorization header when session token is present', async () => {
    mockGetSession.mockResolvedValue({ accessToken: 'my-tok', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
    mockFetch.mockResolvedValue(jsonResponse(200, { imported: 1, failed: 0, errors: [] }));

    await client.upload('/transactions/upload-import', makeFile());

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-tok');
  });

  it('does not set Content-Type (let fetch set multipart boundary automatically)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await client.upload('/some', makeFile());

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('returns wrapped ApiResponse when backend sends plain object', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { imported: 5, failed: 1, errors: ['row 2'] }));

    const result = await client.upload<{ imported: number }>('/transactions/upload-import', makeFile());

    expect(result.success).toBe(true);
    expect((result.data as { imported: number }).imported).toBe(5);
  });

  it('throws on non-ok response with backend error message', async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { detail: 'Only CSV files are supported' }));

    await expect(client.upload('/transactions/upload-import', makeFile('data.xlsx'))).rejects.toThrow(
      'Only CSV files are supported'
    );
  });

  it('throws timeout error when request is aborted', async () => {
    mockFetch.mockImplementation(() => new Promise((_, reject) => {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      setTimeout(() => reject(err), 10);
    }));

    await expect(client.upload('/some', makeFile(), {}, { timeout: 1 })).rejects.toThrow(/timeout/i);
  });
});

// ─── transactionService integration ──────────────────────────────────────────

describe('transactionService.bulkImport', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  it('calls /transactions/upload-import with the file', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { imported: 2, failed: 0, errors: [] }));
    const { transactionService } = await import('@/services/transactionService');
    const file = makeFile('import.csv');

    await transactionService.bulkImport(file);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/transactions/upload-import');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('file')).toBe(file);
  });
});

describe('transactionService.scanReceipt', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  it('calls /transactions/scan-receipt with the file', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { amount: 12.5, description: 'Coffee' }));
    const { transactionService } = await import('@/services/transactionService');
    const file = makeFile('receipt.jpg', 'image/jpeg');

    await transactionService.scanReceipt(file);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/transactions/scan-receipt');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('file')).toBe(file);
  });
});
