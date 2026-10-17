/**
 * The unwrapping layer, which nothing exercised.
 *
 * `getExchangeRates` read `response.data.success` and `response.data.data`, but
 * `apiClient.get<T>` already returns the ApiResponse envelope — it is not axios,
 * so there is no outer `.data` holding the body. The check never passed and the
 * method always threw. It typed itself `ApiResponse<ApiResponse<T>>`, so the
 * compiler agreed with the mistake.
 *
 * Nothing called it, so nothing noticed. The component tests that came with the
 * feature mocked the hook, so they passed against a service that could not work
 * — the bug only showed by driving the actual page.
 */

const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({
    apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { portfolioService } from '@/services/portfolioService';

describe('portfolioService.getExchangeRates', () => {
    beforeEach(() => mockGet.mockReset());

    it('reads the envelope apiClient actually returns', async () => {
        mockGet.mockResolvedValue({
            success: true,
            data: { base_currency: 'TWD', rates: { USD: 31.631 }, unavailable: [], timestamp: 't' },
            message: null,
        });

        const rates = await portfolioService.getExchangeRates('TWD');
        expect(rates.rates.USD).toBeCloseTo(31.631);
    });

    it('rejects when the server reports failure, so the caller can retry', async () => {
        mockGet.mockResolvedValue({ success: false, data: null, message: 'nope' });
        await expect(portfolioService.getExchangeRates('TWD')).rejects.toThrow('nope');
    });

    it('rejects rather than resolving with invented rates', async () => {
        // It used to swallow this and return a hardcoded table in the shape of a
        // success, so a caller could not tell a real rate from a guess — and the
        // hook's retry never fired, because nothing ever rejected.
        mockGet.mockRejectedValue(new Error('network down'));
        await expect(portfolioService.getExchangeRates('TWD')).rejects.toThrow();
    });
});
