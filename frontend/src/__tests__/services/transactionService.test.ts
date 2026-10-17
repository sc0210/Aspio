import { transactionService } from '@/services/transactionService';
import { apiClient } from '@/lib/api-client';

// Mock the apiClient
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    upload: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('TransactionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTransactions', () => {
    it('should fetch transactions with default filters', async () => {
      // The service maps backend rows through transformTransaction, so the
      // fixture has to be in BACKEND shape (snake_case, transaction_date). It
      // previously used the frontend shape, and the assertion compared the
      // result against that same un-mapped object — so it passed nothing
      // through the mapper and asserted date: undefined without noticing.
      const backendRow = {
        id: '1',
        user_id: 'user1',
        type: 'expense',
        amount: 100,
        currency: 'TWD',
        category: 'Food',
        description: 'Lunch',
        transaction_date: '2024-01-01',
        payment_method: 'cash',
        wallet_type: 'life',
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockApiClient.get.mockResolvedValue({ success: true, data: [backendRow], meta: { total: 1, page: 1, limit: 20, total_pages: 1, has_next: false, has_previous: false } });

      const result = await transactionService.getTransactions();

      expect(mockApiClient.get).toHaveBeenCalledWith('/transactions/?');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Transactions retrieved successfully');
      expect(result.data).toHaveLength(1);
      expect(result.data![0]).toMatchObject({
        id: '1',
        userId: 'user1',
        type: 'expense',
        amount: 100,
        currency: 'TWD',
        category: 'Food',
        description: 'Lunch',
        date: '2024-01-01',
        paymentMethod: 'cash',
        walletType: 'life',
      });
      expect(result.data![0].createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('should fetch transactions with filters', async () => {
      const filters = {
        type: 'expense' as const,
        category: 'Food',
        search: 'lunch',
        page: 1,
        limit: 20
      };

      const mockResponse = {
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 20, total_pages: 0, has_next: false, has_previous: false }
      };

      mockApiClient.get.mockResolvedValue(mockResponse);

      await transactionService.getTransactions(filters);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/?')
      );
      
      const callArgs = mockApiClient.get.mock.calls[0][0];
      expect(callArgs).toContain('type=expense');
      expect(callArgs).toContain('category=Food');
      expect(callArgs).toContain('search=lunch');
    });

    it('should handle date range filters', async () => {
      const filters = {
        dateRange: {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31')
        }
      };

      mockApiClient.get.mockResolvedValue({ success: true, data: [] });

      await transactionService.getTransactions(filters);

      // The backend takes date_from/date_to as plain local YYYY-MM-DD. Sending
      // a UTC ISO timestamp instead shifted the range by a day for TW users,
      // which is why localDateString is used rather than toISOString.
      const callArgs = mockApiClient.get.mock.calls[0][0];
      expect(callArgs).toContain('date_from=2024-01-01');
      expect(callArgs).toContain('date_to=2024-01-31');
    });
  });

  describe('createTransaction', () => {
    it('should create a transaction', async () => {
      const transactionData = {
        type: 'expense' as const,
        amount: 50,
        category: 'Food',
        description: 'Coffee',
        date: new Date('2024-01-01'),
        paymentMethod: 'card',
        currency: 'USD'
      };

      // The backend wraps the created row as { transaction: {...} } in backend
      // shape; the service only transforms when that wrapper is present and
      // otherwise reports "response format unexpected".
      mockApiClient.post.mockResolvedValue({
        success: true,
        data: {
          transaction: {
            id: '2',
            user_id: 'user1',
            type: 'expense',
            amount: 50,
            currency: 'USD',
            category: 'Food',
            description: 'Coffee',
            transaction_date: '2024-01-01',
            payment_method: 'card',
            wallet_type: 'life',
            tags: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        },
      });

      const result = await transactionService.createTransaction(transactionData);

      // Expect the backend schema format, not the frontend format
      expect(mockApiClient.post).toHaveBeenCalledWith('/transactions/', expect.objectContaining({
        type: 'expense',
        amount: 50,
        currency: 'USD',
        description: 'Coffee',
        transaction_date: '2024-01-01',
        payment_method: 'card',
        // category_name, not category_id: the id is resolved separately and
        // only attached when it resolves, so the name is what always ships.
        category_name: 'Food',
        wallet_type: 'life',
        tags: [],
        tax_deductible: false,
        business_expense: false
      }));
      expect(result.success).toBe(true);
      expect(result.message).toBe('Transaction created successfully');
      expect(result.data).toMatchObject({
        id: '2',
        userId: 'user1',
        type: 'expense',
        amount: 50,
        currency: 'USD',
        category: 'Food',
        description: 'Coffee',
        paymentMethod: 'card',
        walletType: 'life',
      });
      // createTransaction hands back a Date here, unlike getTransactions which
      // keeps the backend's ISO string.
      expect(result.data!.date).toEqual(new Date('2024-01-01'));
    });

    it('should handle API errors', async () => {
      const transactionData = {
        type: 'expense' as const,
        amount: 50,
        category: 'Food',
        description: 'Coffee',
        date: new Date('2024-01-01'),
        currency: 'USD',
      };

      mockApiClient.post.mockRejectedValue(new Error('Network error'));

      await expect(transactionService.createTransaction(transactionData))
        .rejects.toThrow('Network error');
    });
  });

  describe('updateTransaction', () => {
    it('should update a transaction', async () => {
      const id = '1';
      const updates = { amount: 75, description: 'Updated lunch' };

      mockApiClient.put.mockResolvedValue({
        success: true,
        data: {
          id,
          user_id: 'user1',
          type: 'expense',
          amount: 75,
          currency: 'TWD',
          category: 'Food',
          description: 'Updated lunch',
          transaction_date: '2024-01-01',
          wallet_type: 'life',
          tags: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      });

      const result = await transactionService.updateTransaction(id, updates);

      // Only the fields actually supplied are forwarded, and they go out under
      // the backend's names — the body is built field by field, not passed
      // through, so asserting it equals `updates` never described the request.
      expect(mockApiClient.put).toHaveBeenCalledWith(`/transactions/${id}`, {
        amount: 75,
        description: 'Updated lunch',
      });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id, amount: 75, description: 'Updated lunch' });
    });
  });

  describe('deleteTransaction', () => {
    it('should delete a transaction', async () => {
      const id = '1';
      const mockResponse = { success: true };

      mockApiClient.delete.mockResolvedValue(mockResponse);

      const result = await transactionService.deleteTransaction(id);

      expect(mockApiClient.delete).toHaveBeenCalledWith(`/transactions/${id}`);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getCategories', () => {
    it('should fetch transaction categories', async () => {
      const mockResponse = {
        success: true,
        data: [
          { id: '1', name: 'Food', type: 'expense', color: '#ff0000' },
          { id: '2', name: 'Salary', type: 'income', color: '#00ff00' }
        ]
      };

      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await transactionService.getCategories();

      expect(mockApiClient.get).toHaveBeenCalledWith('/transactions/categories');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getStats', () => {
    it('should fetch transaction statistics', async () => {
      const period = '30d';
      const mockResponse = {
        success: true,
        data: {
          totalIncome: 5000,
          totalExpenses: 3000,
          netIncome: 2000,
          savingsRate: 40,
          topCategories: [],
          monthlyTrend: [],
          categoryBreakdown: []
        }
      };

      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await transactionService.getStats(period);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        `/transactions/analytics/summary?period=${period}`
      );
      expect(result).toEqual(mockResponse);
    });

    it('should use default period when none provided', async () => {
      mockApiClient.get.mockResolvedValue({ success: true, data: {} });

      await transactionService.getStats();

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/transactions/analytics/summary?period=30d'
      );
    });
  });

  describe('scanReceipt', () => {
    it('should scan receipt and extract transaction data', async () => {
      const mockFile = new File(['receipt content'], 'receipt.jpg', {
        type: 'image/jpeg'
      });

      const mockResponse = {
        success: true,
        data: {
          amount: 25.50,
          category: 'Food',
          description: 'Restaurant meal',
          date: '2024-01-01'
        }
      };

      mockApiClient.upload.mockResolvedValue(mockResponse);

      const result = await transactionService.scanReceipt(mockFile);

      expect(mockApiClient.upload).toHaveBeenCalledWith('/transactions/scan-receipt', mockFile);
      expect(result).toEqual(mockResponse);
    });
  });
});