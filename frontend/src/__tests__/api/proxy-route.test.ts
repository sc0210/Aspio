/**
 * The /api/proxy route must forward a request body byte-for-byte, with the
 * caller's Content-Type. It used to force application/json and read the body as
 * text, which dropped a multipart upload's boundary and mangled the file: every
 * receipt scan and CSV import through the proxy came back 422 "file required".
 */

jest.mock('next/server', () => {
  class NextResponse {
    constructor(public body: unknown, public init?: { status?: number }) {}
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init);
    }
  }
  return { NextRequest: jest.fn(), NextResponse };
});
jest.mock('@/lib/safe-get-token', () => ({
  safeGetToken: jest.fn().mockResolvedValue({ accessToken: 'backend-token' }),
}));

import { POST } from '@/app/api/proxy/[...path]/route';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeRequest(body: Uint8Array, contentType: string | null) {
  return {
    url: 'http://localhost:3000/api/proxy/transactions/scan-receipt',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: jest.fn().mockResolvedValue(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  };
}

/** ASCII bytes; jsdom has no TextEncoder. */
const ascii = (str: string) => Uint8Array.from(str, (c) => c.charCodeAt(0));

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

/** jsdom's Blob has no arrayBuffer(); FileReader reads it. */
function blobBytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    status: 200,
    headers: { get: () => 'application/json' },
    text: jest.fn().mockResolvedValue('{"amount":120}'),
  });
});

describe('POST /api/proxy/[...path]', () => {
  it('forwards a multipart upload with its boundary and its exact bytes', async () => {
    // Bytes that are not valid UTF-8, as in any image: text() would replace them.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
    const contentType = 'multipart/form-data; boundary=----abc123';

    await POST(makeRequest(bytes, contentType) as never, params(['transactions', 'scan-receipt']));

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/transactions\/scan-receipt$/);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(contentType);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer backend-token');
    expect(await blobBytes(init.body as Blob)).toEqual(Array.from(bytes));
  });

  it('sends the body as a Blob, which fetch can re-send when it follows a redirect', async () => {
    // A bare ArrayBuffer is detached by the first send; POST /transactions is
    // redirected to /transactions/, and the retry failed with "fetch failed".
    const json = ascii('{"amount":1}');
    await POST(makeRequest(json, 'application/json') as never, params(['transactions']));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(Blob);
    expect(await blobBytes(init.body as Blob)).toEqual(Array.from(json));
  });

  it('defaults to application/json when the caller sends no Content-Type', async () => {
    await POST(makeRequest(ascii('{}'), null) as never, params(['transactions']));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
