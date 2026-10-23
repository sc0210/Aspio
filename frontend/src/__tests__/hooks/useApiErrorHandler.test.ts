import { renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useAppMode } from '@/hooks/useAppMode';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';

jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('@/hooks/useAppMode', () => ({ useAppMode: jest.fn() }));

const toastError = (toast as unknown as { error: jest.Mock }).error;
const mockMode = useAppMode as jest.Mock;

function setup(isDemo = false) {
  mockMode.mockReturnValue({ isDemo });
  return renderHook(() => useApiErrorHandler()).result.current;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => (console.error as jest.Mock).mockRestore());

const err = (statusCode?: number, extra: object = {}) =>
  Object.assign(new Error('boom'), { statusCode, ...extra });

describe('handleApiError', () => {
  it.each([
    [undefined, false, 'common:apiErrors.networkError'],
    [undefined, true, 'common:apiErrors.demoMode'],
    [401, false, 'common:apiErrors.authRequired'],
    [401, true, 'common:apiErrors.demoAuth'],
    [403, false, 'common:apiErrors.forbidden'],
    [404, false, 'common:apiErrors.notFound'],
    [503, false, 'common:apiErrors.serverError'],
    [429, false, 'common:apiErrors.tooManyRequests'],
    [409, false, 'boom'],
  ])('status %s (demo %s) shows %s', (status, isDemo, message) => {
    setup(isDemo).handleApiError(err(status));
    expect(toastError).toHaveBeenCalledWith(message);
  });

  it('shows the server validation message for 422', () => {
    setup().handleApiError(err(422, { response: { data: { message: 'Amount must be positive' } } }));
    expect(toastError).toHaveBeenCalledWith('Amount must be positive');
  });

  it('falls back to a generic validation message', () => {
    setup().handleApiError(err(422));
    expect(toastError).toHaveBeenCalledWith('Invalid data provided');
  });
});

describe('handleQueryError / createErrorHandler', () => {
  it('reads the status from an axios-shaped response', () => {
    setup().createErrorHandler('save')({ message: 'x', response: { status: 404 } });
    expect(toastError).toHaveBeenCalledWith('common:apiErrors.notFound');
    expect(console.error).toHaveBeenCalledWith('API Error in save:', expect.anything());
  });

  it('treats an error with no status as a network error', () => {
    setup().handleQueryError({});
    expect(toastError).toHaveBeenCalledWith('common:apiErrors.networkError');
  });
});

describe('getErrorMessage', () => {
  it.each([
    [null, false, 'Unknown error'],
    [{ statusCode: 401 }, false, 'Please sign in to access this feature'],
    [{ statusCode: 401 }, true, 'Demo mode: Authentication required'],
    [{ statusCode: 404 }, false, 'Data not found'],
    [{ statusCode: 500 }, false, 'Server error occurred'],
    [{ isNetworkError: true }, false, 'Connection error'],
    [{}, true, 'Demo mode: Using sample data'],
    [{ statusCode: 400, message: 'bad' }, false, 'bad'],
    [{ statusCode: 400 }, false, 'An error occurred'],
  ])('%j (demo %s) → %s', (input, isDemo, expected) => {
    expect(setup(isDemo).getErrorMessage(input)).toBe(expected);
  });
});

describe('isRetryableError', () => {
  it.each([
    [null, false, false],
    [{ statusCode: 401 }, true, false],
    [{ statusCode: 401 }, false, false],
    [{ isNetworkError: true }, false, true],
    [{ statusCode: 502 }, false, true],
    [{ statusCode: 429 }, false, true],
    [{ statusCode: 400 }, false, false],
  ])('%j (demo %s) → %s', (input, isDemo, expected) => {
    expect(setup(isDemo).isRetryableError(input)).toBe(expected);
  });
});
