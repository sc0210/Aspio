import { act, renderHook, waitFor } from '@testing-library/react';
import { getProviders } from 'next-auth/react';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import { useFeatures } from '@/hooks/useFeatures';

jest.mock('@/hooks/useFeatures', () => ({ useFeatures: jest.fn() }));
jest.mock('next-auth/react', () => ({ getProviders: jest.fn() }));
const mockFeatures = useFeatures as jest.Mock;
const mockProviders = getProviders as unknown as jest.Mock;

const features = (over: Record<string, unknown> = {}) =>
    mockFeatures.mockReturnValue({ lineBot: true, googleLogin: true, email: true, isLoading: false, isError: false, ...over });

describe('useGoogleSignIn', () => {
    beforeEach(() => mockProviders.mockReset());

    it('offers Google when the frontend provider and the backend are both configured', async () => {
        features(); mockProviders.mockResolvedValue({ google: {}, credentials: {} });
        const { result } = renderHook(() => useGoogleSignIn());
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('hides it when the frontend has no Google provider', async () => {
        features(); mockProviders.mockResolvedValue({ credentials: {} });
        const { result } = renderHook(() => useGoogleSignIn());
        // Let the providers answer land before asserting, or this passes on the initial state.
        await act(async () => { await mockProviders.mock.results[0].value; });
        expect(result.current).toBe(false);
    });

    it('treats an unknown provider list (null) as available, not a lockout', async () => {
        features(); mockProviders.mockResolvedValue(null);
        const { result } = renderHook(() => useGoogleSignIn());
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('hides it when the backend says no, or while /features loads', async () => {
        mockProviders.mockResolvedValue({ google: {} });
        features({ googleLogin: false });
        const off = renderHook(() => useGoogleSignIn());
        await waitFor(() => expect(mockProviders).toHaveBeenCalled());
        expect(off.result.current).toBe(false);
        features({ isLoading: true });
        const loading = renderHook(() => useGoogleSignIn());
        await waitFor(() => expect(mockProviders).toHaveBeenCalledTimes(2));
        expect(loading.result.current).toBe(false);
    });
});
