import { apiClient } from '@/lib/api-client';
import { priceService } from '@/services/priceService';

jest.mock('@/lib/api-client', () => ({ apiClient: { get: jest.fn() } }));

const api = apiClient as jest.Mocked<typeof apiClient>;

describe('priceService.getLatestPricesBulk', () => {
  it('asks the backend nothing when there are no symbols', async () => {
    await expect(priceService.getLatestPricesBulk([])).resolves.toEqual({});
    expect(api.get).not.toHaveBeenCalled();
  });
});
