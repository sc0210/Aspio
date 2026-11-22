import { backendError } from '@/lib/backendError';

describe('backendError', () => {
  it('reads the wrapped error every backend handler returns', () => {
    expect(backendError({
      success: false,
      error: { code: 'HTTP_ERROR', message: 'Invalid or expired verification token', details: {} },
    })).toEqual({ code: 'HTTP_ERROR', message: 'Invalid or expired verification token' });
  });

  it('still reads a bare FastAPI detail or a flat message', () => {
    expect(backendError({ detail: 'Not found' }).message).toBe('Not found');
    expect(backendError({ message: 'Too many requests', code: 'RATE_LIMITED' })).toEqual({ message: 'Too many requests', code: 'RATE_LIMITED' });
  });

  it('ignores a 422 detail list rather than showing "[object Object]"', () => {
    expect(backendError({ detail: [{ loc: ['body', 'email'], msg: 'bad' }] }).message).toBeUndefined();
  });

  it('copes with no body at all', () => {
    expect(backendError(undefined)).toEqual({ message: undefined, code: undefined });
  });
});
