import { ApiClient } from '@/lib/api-client';
import { getSession } from 'next-auth/react';
import { transactionService } from '@/services/transactionService';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockGetSession = getSession as jest.Mock;

// createTransaction delegates to transactionService and swallows ANY error into a
// fabricated demo transaction (`demo-<ts>` / `demo-user`). Unmocked, the service
// throws here and the test silently asserted against that fallback instead of the
// real path. Mock it so the delegation is what's under test.
jest.mock('@/services/transactionService', () => ({
  transactionService: {
    createTransaction: jest.fn(async (t: Record<string, unknown>) => ({
      success: true,
      data: { id: '2', userId: 'user1', ...t },
    })),
  },
}));

/** A fetch Response shaped the way api-client actually reads it. */
function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: jest.fn().mockResolvedValue({ success: true, data: body }),
    text: jest.fn().mockResolvedValue(''),
  };
}

describe('ApiClient', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    // Reset fetch mock
    mockFetch.mockReset();

    // Reset the session too. Only the "session token caching" describe used to
    // reset this, so once it ran, its last mocked session (near-expiry-tok) stayed
    // resolved for every later test — they saw that Authorization header instead of
    // the token they set. Default to no session so the internal token is used.
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);

    // Create new instance for each test
    apiClient = new ApiClient();
    
    // Set default successful response.
    //
    // `headers.get` and `text` are both required, not optional niceties: the
    // client branches on the content-type header, and without one reporting JSON
    // it falls into the non-JSON path and calls response.text() — surfacing as
    // "response.text is not a function" rather than anything about the header.
    mockFetch.mockResolvedValue(makeJsonResponse({ test: 'data' }));
  });

  describe('initialization', () => {
    // get() is async and awaits the session before it ever calls fetch, so these
    // must await the request. Asserting synchronously reports "Number of calls: 0",
    // which reads as a routing bug rather than a missing await.
    it('should initialize with default base URL when no env var is set', async () => {
      // next/jest loads frontend/.env, which sets this on a dev machine, so unset
      // it here rather than relying on the environment being clean (CI has no .env).
      const saved = process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      try {
        await new ApiClient().get('/test');

        // Same-origin by default, so one prebuilt image works on any domain.
        expect(mockFetch).toHaveBeenCalledWith('/api/v1/test', expect.any(Object));
      } finally {
        if (saved !== undefined) process.env.NEXT_PUBLIC_API_URL = saved;
      }
    });

    it('should use environment variable for base URL', async () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/v1';

      const customClient = new ApiClient();
      await customClient.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/test',
        expect.any(Object)
      );

      delete process.env.NEXT_PUBLIC_API_URL;
    });
  });

  describe('session token caching', () => {
    beforeEach(() => mockGetSession.mockReset());

    it('calls getSession only once across multiple requests when token is fresh', async () => {
      mockGetSession.mockResolvedValue({ accessToken: 'fresh-token', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
      mockFetch.mockResolvedValue(makeJsonResponse({ ok: true }));

      await apiClient.get('/a');
      await apiClient.get('/b');
      await apiClient.get('/c');

      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });

    it('uses session token over internal accessToken', async () => {
      mockGetSession.mockResolvedValue({ accessToken: 'session-tok', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
      apiClient.setAccessToken('internal-tok');
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await apiClient.get('/test');

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toBe('Bearer session-tok');
    });

    it('falls back to internal token when getSession returns null', async () => {
      mockGetSession.mockResolvedValue(null);
      apiClient.setAccessToken('fallback-tok');
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await apiClient.get('/test');

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toBe('Bearer fallback-tok');
    });

    it('invalidates session cache when clearAccessToken is called', async () => {
      mockGetSession.mockResolvedValue({ accessToken: 'tok', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await apiClient.get('/a');
      apiClient.clearAccessToken();
      await apiClient.get('/b');

      // getSession must be called again after cache clear
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('re-fetches session when token is within 60 s of expiry', async () => {
      // Expire in 30 s — within the 60 s refresh window
      const nearExpiry = Math.floor(Date.now() / 1000) + 30;
      mockGetSession.mockResolvedValue({ accessToken: 'near-expiry-tok', accessTokenExpires: nearExpiry });
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await apiClient.get('/a');
      await apiClient.get('/b');

      // Each request should re-fetch because expiry is always < now + 60s
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('shares one getSession call across concurrent requests', async () => {
      // A page's queries all fire at once on a cold cache; each used to make its
      // own /api/auth/session round-trip before the first data request went out.
      mockGetSession.mockResolvedValue({ accessToken: 'tok', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await Promise.all([apiClient.get('/a'), apiClient.get('/b'), apiClient.get('/c')]);

      expect(mockGetSession).toHaveBeenCalledTimes(1);
      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers['Authorization']).toBe('Bearer tok');
      }
    });

    it('does not cache a token whose lookup resolved after clearAccessToken', async () => {
      let resolveSession: (s: unknown) => void = () => {};
      mockGetSession.mockReturnValueOnce(new Promise((r) => { resolveSession = r; }));
      mockGetSession.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      const inFlight = apiClient.get('/a');
      apiClient.clearAccessToken(); // signed out while the lookup was pending
      resolveSession({ accessToken: 'old-tok', accessTokenExpires: Math.floor(Date.now() / 1000) + 3600 });
      await inFlight;
      await apiClient.get('/b');

      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBeUndefined();
    });
  });

  describe('setAccessToken', () => {
    it('should set access token for authenticated requests', async () => {
      const token = 'test-access-token';
      apiClient.setAccessToken(token);
      
      await apiClient.get('/test');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${token}`
          })
        })
      );
    });

    it('should clear access token', async () => {
      apiClient.setAccessToken('test-token');
      apiClient.clearAccessToken();
      
      await apiClient.get('/test');
      
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('HTTP methods', () => {
    describe('GET requests', () => {
      it('should make GET request with correct parameters', async () => {
        await apiClient.get('/users');
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/users',
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            })
          })        );
      });

      it('should return parsed response data', async () => {
        const mockData = { users: [{ id: 1, name: 'Test' }] };
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockData
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const response = await apiClient.get('/users');
        
        expect(response.data).toEqual(mockData);
        expect(response.success).toBe(true);
      });
    });

    describe('POST requests', () => {
      it('should make POST request with data', async () => {
        const postData = { name: 'New User', email: 'test@example.com' };
        
        await apiClient.post('/users', postData);
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/users',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify(postData)
          })        );
      });

      it('should make POST request without data', async () => {
        await apiClient.post('/users/logout');
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/users/logout',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: undefined
          })        );
      });
    });

    describe('PUT requests', () => {
      it('should make PUT request with data', async () => {
        const updateData = { name: 'Updated User' };
        
        await apiClient.put('/users/1', updateData);
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/users/1',
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify(updateData)
          })        );
      });
    });

    describe('DELETE requests', () => {
      it('should make DELETE request', async () => {
        await apiClient.delete('/users/1');
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/users/1',
          expect.objectContaining({
            method: 'DELETE',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            })
          })        );
      });
    });
  });

  describe('error handling', () => {
    it('should throw error for non-ok response', async () => {
      mockFetch.mockResolvedValue({
        headers: { get: () => 'application/json' },
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          success: false,
          message: 'Bad Request'
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      await expect(apiClient.get('/test')).rejects.toThrow('Bad Request');
    });

    it('should throw error with status when no message provided', async () => {
      mockFetch.mockResolvedValue({
        headers: { get: () => 'application/json' },
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          success: false
        }),
        text: jest.fn().mockResolvedValue(''),
      });

      await expect(apiClient.get('/test')).rejects.toThrow('HTTP error! status: 500');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(apiClient.get('/test')).rejects.toThrow('Network error');
    });

    it('should handle JSON parsing errors', async () => {
      mockFetch.mockResolvedValue({
        headers: { get: () => 'application/json' },
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: jest.fn().mockResolvedValue(''),
      });

      // The client deliberately degrades rather than throwing: an unparseable
      // body becomes an empty ApiResponse carrying the HTTP outcome.
      const response = await apiClient.get('/test');
      expect(response.success).toBe(true);
    });
  });

  describe('service methods', () => {
    describe('transactions', () => {
      it('should get transactions', async () => {
        const mockTransactions = [
          { id: '1', amount: 100, category: 'Food' }
        ];
        
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockTransactions
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.getTransactions();
        
        // The client normalises each row (date / paymentMethod / tags), so assert
        // the meaningful fields rather than deep-equalling the raw fixture.
        expect(result).toHaveLength(mockTransactions.length);
        expect(result[0]).toEqual(expect.objectContaining(mockTransactions[0]));
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/transactions/',
          expect.any(Object)
        );
      });

      it('should create transaction', async () => {
        const transactionData = {
          type: 'expense' as const,
          amount: 50,
          category: 'Food',
          description: 'Lunch',
          // Both required by the create payload; the fixture omitted them, so
          // it was not the shape a real caller sends.
          currency: 'USD',
          date: new Date('2024-01-01'),
        };

        const mockCreatedTransaction = {
          id: '2',
          ...transactionData,
          userId: 'user1'
        };

        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockCreatedTransaction
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.createTransaction(transactionData);
        
        expect(result).toEqual(mockCreatedTransaction);
        // createTransaction no longer issues the request itself — it delegates to
        // transactionService (which owns the dual-mode/demo handling), so assert the
        // delegation rather than a direct fetch that never happens.
        expect(transactionService.createTransaction).toHaveBeenCalledWith(transactionData);
      });

      it('propagates a create failure instead of faking a demo transaction', async () => {
        // Regression guard. This used to swallow any error and return a synthesised
        // `demo-<ts>` / `demo-user` object, so a backend failure was indistinguishable
        // from success — the row appeared in the UI and nothing was persisted.
        const boom = new Error('backend exploded');
        (transactionService.createTransaction as jest.Mock).mockRejectedValueOnce(boom);

        await expect(
          apiClient.createTransaction({
            type: 'expense',
            amount: 50,
            category: 'Food',
            description: 'Lunch',
          } as Parameters<typeof apiClient.createTransaction>[0]),
        ).rejects.toThrow('backend exploded');
      });
    });

    describe('goals', () => {
      it('should get goals', async () => {
        const mockGoals = [
          { id: '1', title: 'Emergency Fund', targetAmount: 10000 }
        ];
        
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockGoals
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.getGoals();
        
        expect(result).toEqual(mockGoals);
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/goals/',
          expect.any(Object)
        );
      });
    });

    describe('portfolio', () => {
      it('should get portfolio', async () => {
        const mockPortfolio = {
          id: '1',
          totalValue: 50000,
          holdings: []
        };
        
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockPortfolio
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.getPortfolio();
        
        expect(result).toEqual(mockPortfolio);
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/portfolio/',
          expect.any(Object)
        );
      });
    });

    describe('dashboard', () => {
      it('should get dashboard data with default period', async () => {
        const mockDashboardData = {
          totalBalance: 25000,
          monthlyIncome: 5000
        };
        
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: mockDashboardData
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.getDashboardData();
        
        expect(result).toEqual(mockDashboardData);
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/dashboard/stats?period=30d',
          expect.any(Object)
        );
      });

      it('should get dashboard data with custom period', async () => {
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            success: true,
            data: {}
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        await apiClient.getDashboardData('90d');
        
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/v1/dashboard/stats?period=90d',
          expect.any(Object)
        );
      });
    });

    describe('health check', () => {
      it('should perform health check', async () => {
        mockFetch.mockResolvedValue({
          headers: { get: () => 'application/json' },
          ok: true,
          json: jest.fn().mockResolvedValue({
            status: 'healthy',
            service: 'aspiro-backend'
          }),
          text: jest.fn().mockResolvedValue(''),
        });

        const result = await apiClient.healthCheck() as { status: string };
        
        expect(result.status).toBe('healthy');
        expect(mockFetch).toHaveBeenCalledWith('/health');
      });
    });
  });
});