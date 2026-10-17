import { apiClient } from '@/lib/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { Transaction, TransactionCategory, ApiResponse, PaginationParams, ChartDataPoint } from '@/shared/types';
import { localDateString } from '@/utils/formatters';
import { log } from '@/utils/logger';

interface TransactionFilters extends PaginationParams {
  category?: string;
  type?: 'income' | 'expense' | 'transfer';
  walletType?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

/**
 * `getPageStats` only. Kept off `TransactionFilters` because the list endpoints
 * share that shape and silently drop anything they do not build a query param
 * for — a caller asking `getAllTransactions` for a transfer-free export would
 * type-check and still get every leg.
 */
interface PageStatsFilters extends TransactionFilters {
  excludeTransfers?: boolean;
}

export interface PageStatsCategoryItem {
  category: string;
  amount: number;
  type: string;
  color: string;
}

/** TWD-normalized stats payload from GET /transactions/stats. */
export interface TransactionPageStats {
  stats: {
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    transactionCount: number;
    avgTransactionAmount: number;
  };
  categoryBreakdown: PageStatsCategoryItem[];
  expenseCategoryBreakdown: PageStatsCategoryItem[];
  topExpenses: Transaction[];
  topIncome: Transaction[];
}

interface TransactionStats {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  savingsRate: number;
  topCategories: {
    category: string;
    amount: number;
    percentage: number;
  }[];
  monthlyTrend: ChartDataPoint[];
  categoryBreakdown: ChartDataPoint[];
}

class TransactionService {
  // Cache for category name to ID mapping
  private categoryCache: Map<string, string> = new Map();

  private async getCategoryIdByName(categoryName: string): Promise<string | null> {
    // Check cache first
    if (this.categoryCache.has(categoryName)) {
      return this.categoryCache.get(categoryName)!;
    }

    try {
      // Try to get categories from backend
      const response = await this.getCategories();
      if (response.data) {
        // Build cache
        response.data.forEach((category: TransactionCategory) => {
          this.categoryCache.set(category.name, String(category.id));
        });

        // Return the requested category ID
        if (this.categoryCache.has(categoryName)) {
          return this.categoryCache.get(categoryName)!;
        }
      }
    } catch (error) {
      log.warn('Could not fetch categories from backend', error, 'TransactionService');
    }

    // ⚠️ Return null if category not found - let backend handle category_name
    log.debug('Category ID not found, will use category_name fallback', { categoryName }, 'TransactionService');
    return null;
  }

  /** Transform a raw backend transaction row into the frontend Transaction shape. */
  private transformTransaction(tx: Record<string, unknown>): Transaction {
    return {
      id: tx.id as string,
      userId: tx.user_id as string,
      type: tx.type as Transaction['type'],
      amount: tx.amount as number,
      currency: tx.currency as string,
      category: ((tx.category_obj as Record<string, unknown> | undefined)?.name ?? tx.category ?? 'Other') as string,
      subcategory: tx.subcategory as string | undefined,
      description: tx.description as string,
      date: tx.transaction_date as string, // Keep as ISO string from backend; components convert as needed
      paymentMethod: tx.payment_method as string | undefined,
      // GET/PUT single-transaction endpoints serialize this field by its
      // Pydantic alias ("walletType"); the list endpoint doesn't, and sends
      // "wallet_type" — read whichever is present.
      walletType: ((tx.walletType ?? tx.wallet_type) ?? 'life') as Transaction['walletType'],
      tags: (tx.tags as string[]) || [],
      location: tx.location as string | undefined,
      transferGroupId: (tx.transferGroupId ?? tx.transfer_group_id) as string | undefined,
      loanId: (tx.loanId ?? tx.loan_id) as string | undefined,
      createdAt: new Date(tx.created_at as string),
      updatedAt: new Date(tx.updated_at as string)
    } as Transaction;
  }

  async getTransactions(filters: TransactionFilters = {}): Promise<ApiResponse<Transaction[]>> {
    try {
      log.debug('Getting transactions with filters', filters, 'TransactionService');

      // Build query parameters from filters
      const queryParams = new URLSearchParams();

      if (filters.page) queryParams.append('page', filters.page.toString());
      if (filters.limit) queryParams.append('limit', filters.limit.toString());
      if (filters.sortBy) queryParams.append('sort_by', filters.sortBy);
      if (filters.sortOrder) queryParams.append('sort_order', filters.sortOrder);
      if (filters.category) queryParams.append('category', filters.category);
      if (filters.type) queryParams.append('type', filters.type);
      if (filters.walletType) queryParams.append('wallet_type', filters.walletType);
      if (filters.search) queryParams.append('search', filters.search);
      if (filters.minAmount) queryParams.append('amount_min', filters.minAmount.toString());
      if (filters.maxAmount) queryParams.append('amount_max', filters.maxAmount.toString());

      if (filters.dateRange) {
        // localDateString avoids the UTC off-by-one of toISOString()
        queryParams.append('date_from', localDateString(filters.dateRange.start));
        queryParams.append('date_to', localDateString(filters.dateRange.end));
      }

      const endpoint = `/transactions/?${queryParams.toString()}`;
      const response = await apiClient.get(endpoint);

      // Handle different response formats from backend
      let transactions: Transaction[] = [];
      if (response.data) {
        let rawTransactions: Record<string, unknown>[] = [];
        const responseData = response.data as Record<string, unknown> | Record<string, unknown>[];
        if (Array.isArray(responseData)) {
          rawTransactions = responseData;
        } else if (responseData.transactions && Array.isArray(responseData.transactions)) {
          rawTransactions = responseData.transactions as Record<string, unknown>[];
        }

        // Transform backend transaction format to frontend Transaction interface
        transactions = rawTransactions.map((tx) => this.transformTransaction(tx));
      }

      log.debug('Transactions retrieved successfully', { count: transactions.length }, 'TransactionService');

      // The backend returns pagination fields at the top level of the payload
      // ({transactions, total, page, limit, total_pages, ...}) — map them into
      // the ApiResponse meta shape the hooks consume.
      const rd = (response.data ?? {}) as Record<string, unknown>;
      const meta =
        typeof rd.total === 'number'
          ? {
              page: rd.page as number,
              limit: rd.limit as number,
              total: rd.total as number,
              total_pages: rd.total_pages as number,
              has_next: rd.has_next as boolean,
              has_previous: rd.has_previous as boolean,
            }
          : response.meta;

      return {
        data: transactions,
        message: 'Transactions retrieved successfully',
        success: true,
        meta
      };
    } catch (error) {
      log.apiError('GET', '/transactions', error);

      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        log.warn('Authentication error when fetching transactions - session may be stale', undefined, 'TransactionService');
      }

      return {
        data: [],
        message: status
          ? `Failed to load transactions (${status})`
          : 'Failed to load transactions — check your connection',
        success: false
      };
    }
  }

  /**
   * Fetch every page matching the filters. Reserved for rare, explicit user
   * actions (CSV export, replace-mode import) — list views use pagination.
   */
  async getAllTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
    const PAGE_LIMIT = 200;
    const MAX_PAGES = 50; // 10k-row ceiling
    const all: Transaction[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.getTransactions({ ...filters, page, limit: PAGE_LIMIT });
      if (!res.success) break;
      const batch = res.data || [];
      for (const t of batch) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          all.push(t);
        }
      }
      if (batch.length < PAGE_LIMIT) break;
    }
    return all;
  }

  /**
   * TWD-normalized stats + category breakdowns + top transactions for the
   * transactions page. Server-side replacement for fetching every row.
   */
  async getPageStats(filters: PageStatsFilters = {}): Promise<ApiResponse<TransactionPageStats>> {
    try {
      const queryParams = new URLSearchParams();
      if (filters.type) queryParams.append('type', filters.type);
      if (filters.category) queryParams.append('category', filters.category);
      if (filters.walletType) queryParams.append('wallet_type', filters.walletType);
      if (filters.search) queryParams.append('search', filters.search);
      // Both legs of a wallet transfer, left out of the totals when asked. The
      // aggregate has to do it: subtracting client-side would go wrong the moment
      // a wallet or category filter narrowed what the totals covered.
      if (filters.excludeTransfers) queryParams.append('exclude_transfers', 'true');
      if (filters.dateRange) {
        queryParams.append('date_from', localDateString(filters.dateRange.start));
        queryParams.append('date_to', localDateString(filters.dateRange.end));
      }

      const response = await apiClient.get(`/transactions/stats?${queryParams.toString()}`);
      const rd = (response.data ?? {}) as Record<string, unknown>;
      const stats = (rd.stats ?? {}) as Record<string, unknown>;

      const mapBreakdown = (rows: unknown): PageStatsCategoryItem[] =>
        (Array.isArray(rows) ? rows : []).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            category: r.category as string,
            amount: (r.amount as number) ?? 0,
            type: r.type as string,
            color: r.type === 'income' ? '#22c55e' : '#ef4444',
          };
        });

      const mapRows = (rows: unknown): Transaction[] =>
        (Array.isArray(rows) ? rows : []).map((tx) =>
          this.transformTransaction(tx as Record<string, unknown>)
        );

      return {
        success: true,
        data: {
          stats: {
            totalIncome: (stats.total_income as number) ?? 0,
            totalExpenses: (stats.total_expenses as number) ?? 0,
            netIncome: (stats.net_income as number) ?? 0,
            transactionCount: (stats.transaction_count as number) ?? 0,
            avgTransactionAmount: (stats.avg_transaction_amount as number) ?? 0,
          },
          categoryBreakdown: mapBreakdown(rd.category_breakdown),
          expenseCategoryBreakdown: mapBreakdown(rd.expense_category_breakdown),
          topExpenses: mapRows(rd.top_expenses),
          topIncome: mapRows(rd.top_income),
        },
      };
    } catch (error) {
      log.apiError('GET', '/transactions/stats', error);
      return {
        success: false,
        message: 'Failed to load transaction stats',
      };
    }
  }

  async getTransactionById(id: string): Promise<ApiResponse<Transaction>> {
    try {
      // Check if this is a demo transaction (starts with 'demo-')
      if (id.startsWith('demo-')) {
        // For demo mode, we need to get the transaction from demo context
        // Since we can't access React context here, we'll use localStorage or return a mock
        const demoTransactions = JSON.parse(localStorage.getItem('aspiro_demo_transactions') || '[]');
        const transaction = demoTransactions.find((t: Transaction) => t.id === id);

        if (transaction) {
          return {
            data: transaction,
            message: 'Demo transaction retrieved successfully',
            success: true
          };
        } else {
          return {
            data: null as unknown as Transaction,
            message: 'Demo transaction not found',
            success: false
          };
        }
      }

      // For authenticated mode, call the API
      const response = await apiClient.get(`/transactions/${id}`);

      // Transform backend transaction format to frontend Transaction interface
      if (response.data) {
        const tx = response.data as Record<string, unknown>;
        const transformedTransaction: Transaction & { loan_id?: string | null } = {
          id: tx.id as string,
          userId: tx.user_id as string,
          type: tx.type as Transaction['type'],
          amount: tx.amount as number,
          currency: tx.currency as string,
          category: ((tx.category_obj as Record<string, unknown> | undefined)?.name ?? tx.category ?? 'Other') as string,
          subcategory: tx.subcategory as string | undefined,
          description: tx.description as string,
          date: new Date(tx.transaction_date as string),
          paymentMethod: tx.payment_method as string | undefined,
          walletType: ((tx.walletType ?? tx.wallet_type) ?? 'life') as Transaction['walletType'],
          tags: (tx.tags as string[]) || [],
          location: tx.location as string | undefined,
          transferGroupId: (tx.transferGroupId ?? tx.transfer_group_id) as string | undefined,
          // Surfaced so the edit form can pre-fill the "Link to Loan" selector.
          loan_id: (tx.loan_id ?? tx.loanId) as string | null | undefined,
          createdAt: new Date(tx.created_at as string),
          updatedAt: new Date(tx.updated_at as string)
        };

        return {
          data: transformedTransaction,
          message: 'Transaction retrieved successfully',
          success: true
        };
      }

      return {
        data: null as unknown as Transaction,
        message: 'Transaction not found',
        success: false
      };
    } catch (error) {
      log.apiError('GET', `/transactions/${id}`, error);

      // Fallback for demo mode or API errors
      return {
        data: null as unknown as Transaction,
        message: 'Failed to retrieve transaction',
        success: false
      };
    }
  }

  async createTransaction(
    transaction: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<Transaction>> {
    try {
      // Get category_id or use category_name for backend to resolve
      let categoryId: string | null = null;
      try {
        categoryId = await this.getCategoryIdByName(transaction.category);
      } catch (error) {
        log.warn('Failed to get category ID, sending category_name instead', error, 'TransactionService');
      }

      // Transform frontend Transaction to backend TransactionCreate schema
      const backendTransaction: Record<string, unknown> = {
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency || 'TWD',
        description: transaction.description,
        transaction_date: transaction.date instanceof Date
          ? transaction.date.toISOString().split('T')[0]
          : new Date(transaction.date).toISOString().split('T')[0],
        wallet_type: transaction.walletType || 'life',
        subcategory: transaction.subcategory,
        payment_method: transaction.paymentMethod || null,
        tags: transaction.tags || [],
        location: transaction.location,
        notes: null,
        tax_deductible: false,
        business_expense: false
      };

      // Always send category_name as a resilient fallback, plus category_id when
      // resolved. If category_id is missing OR stale/invalid — e.g. demo category
      // ids (550e8400-…) cached during a transient auth failure, since the
      // /transactions/categories endpoint serves demo data on a bad token — the
      // backend recovers via category_name (_ensure_category_id resolves by name).
      backendTransaction.category_name = transaction.category;
      if (categoryId) {
        backendTransaction.category_id = categoryId;
      }

      const response = await apiClient.post('/transactions/', backendTransaction);

      // Handle the backend response format
      const createData = response.data as Record<string, unknown> | undefined;
      if (createData?.transaction) {
        const tx = createData.transaction as Record<string, unknown>;

        // Transform backend transaction format to frontend Transaction interface
        const transformedTransaction: Transaction = {
          id: tx.id as string,
          userId: tx.user_id as string,
          type: tx.type as Transaction['type'],
          amount: tx.amount as number,
          currency: tx.currency as string,
          category: ((tx.category_obj as Record<string, unknown> | undefined)?.name ?? transaction.category ?? 'Other') as string,
          subcategory: tx.subcategory as string | undefined,
          description: tx.description as string,
          date: new Date(tx.transaction_date as string),
          paymentMethod: tx.payment_method as string | undefined,
          walletType: ((tx.walletType ?? tx.wallet_type) ?? 'life') as Transaction['walletType'],
          tags: (tx.tags as string[]) || [],
          location: tx.location as string | undefined,
          transferGroupId: (tx.transferGroupId ?? tx.transfer_group_id) as string | undefined,
          createdAt: new Date(tx.created_at as string),
          updatedAt: new Date(tx.updated_at as string)
        };

        return {
          data: transformedTransaction,
          message: 'Transaction created successfully',
          success: true
        };
      }

      return {
        data: {} as Transaction,
        message: 'Transaction created but response format unexpected',
        success: false
      };
    } catch (error: unknown) {
      log.apiError('POST', '/transactions/', error);

      // In demo mode or on API error, return a mock successful response
      // This allows the UI to work seamlessly in both modes
      // Check for demo mode authentication error (fetch throws Error, not axios response)
      const errObj = error as { message?: string; response?: { status?: number } };
      const isAuthError = errObj?.message?.includes('Authentication required') ||
        errObj?.message?.includes('401') ||
        errObj?.response?.status === 401;
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      if (isAuthError || isOffline) {
        const mockResponse: ApiResponse<Transaction> = {
          data: {
            id: `demo-${Date.now()}`,
            userId: 'demo-user',
            ...transaction,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          message: 'Demo transaction created (not saved to server)',
          success: true
        };
        return mockResponse;
      }

      throw error;
    }
  }

  /**
   * Put one day's rows in the order the user dragged them into (#478).
   * `ids` may be only the rows the list showed; the backend keeps the others in
   * place and answers with the whole day in its new order. Not for demo mode,
   * which reorders on the client only.
   */
  async setDayOrder(date: string, ids: string[]): Promise<string[]> {
    const response = await apiClient.put<{ date: string; ids: string[] }>(
      '/transactions/day-order',
      { date, ids },
    );
    if (!response.success || !response.data) {
      throw new Error(response.message || 'Reordering the day failed');
    }
    return response.data.ids;
  }

  async updateTransaction(id: string, updates: Partial<Transaction> & { loan_id?: string | null }): Promise<ApiResponse<Transaction>> {
    try {
      // Transform frontend Transaction updates to backend format
      const backendUpdates: Record<string, unknown> = {};

      // Loan link: forward when the caller sets it (null/'' unlinks and restores
      // the loan balance backend-side). `in` check so it's only sent intentionally.
      if ('loan_id' in updates) backendUpdates.loan_id = updates.loan_id ?? null;

      if (updates.type !== undefined) backendUpdates.type = updates.type;
      if (updates.amount !== undefined) backendUpdates.amount = updates.amount;
      if (updates.currency !== undefined) backendUpdates.currency = updates.currency;
      if (updates.description !== undefined) backendUpdates.description = updates.description;
      if (updates.date !== undefined) {
        backendUpdates.transaction_date = updates.date instanceof Date
          ? updates.date.toISOString().split('T')[0]
          : new Date(updates.date).toISOString().split('T')[0];
      }
      if (updates.category !== undefined) {
        // Always send category_name as a resilient fallback (see createTransaction),
        // plus category_id when resolved. A stale/invalid id (e.g. demo ids cached
        // during an auth blip) then can't 500 the edit — the backend resolves by name.
        backendUpdates.category_name = updates.category;
        const categoryId = await this.getCategoryIdByName(updates.category);
        if (categoryId) {
          backendUpdates.category_id = categoryId;
        }
      }
      if (updates.subcategory !== undefined) backendUpdates.subcategory = updates.subcategory;
      if (updates.paymentMethod !== undefined) backendUpdates.payment_method = updates.paymentMethod;
      if (updates.walletType !== undefined) backendUpdates.wallet_type = updates.walletType;
      if (updates.tags !== undefined) backendUpdates.tags = updates.tags;
      if (updates.location !== undefined) backendUpdates.location = updates.location;

      const response = await apiClient.put(`/transactions/${id}`, backendUpdates);

      // Transform backend response to frontend format
      if (response.data) {
        const tx = response.data as Record<string, unknown>;
        const transformedTransaction: Transaction = {
          id: tx.id as string,
          userId: tx.user_id as string,
          type: tx.type as Transaction['type'],
          amount: tx.amount as number,
          currency: tx.currency as string,
          category: ((tx.category_obj as Record<string, unknown> | undefined)?.name ?? tx.category ?? 'Other') as string,
          subcategory: tx.subcategory as string | undefined,
          description: tx.description as string,
          date: new Date(tx.transaction_date as string),
          paymentMethod: tx.payment_method as string | undefined,
          walletType: ((tx.walletType ?? tx.wallet_type) ?? 'life') as Transaction['walletType'],
          tags: (tx.tags as string[]) || [],
          location: tx.location as string | undefined,
          transferGroupId: (tx.transferGroupId ?? tx.transfer_group_id) as string | undefined,
          createdAt: new Date(tx.created_at as string),
          updatedAt: new Date(tx.updated_at as string)
        };

        return {
          data: transformedTransaction,
          message: 'Transaction updated successfully',
          success: true
        };
      }

      return {
        data: null as unknown as Transaction,
        message: 'Transaction update failed',
        success: false
      };
    } catch (error) {
      log.apiError('PUT', `/transactions/${id}`, error);
      throw error;
    }
  }

  async deleteTransaction(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/transactions/${id}`);
  }

  async bulkImport(file: File): Promise<ApiResponse<{ imported: number; failed: number; errors: string[] }>> {
    return apiClient.upload('/transactions/upload-import', file);
  }

  async getCategories(): Promise<ApiResponse<TransactionCategory[]>> {
    return apiClient.get('/transactions/categories');
  }

  async createCategory(category: Omit<TransactionCategory, 'id'>): Promise<ApiResponse<TransactionCategory>> {
    return apiClient.post('/transactions/categories', category);
  }

  async updateCategory(id: string, updates: Partial<TransactionCategory>): Promise<ApiResponse<TransactionCategory>> {
    return apiClient.put(`/transactions/categories/${id}`, updates);
  }

  async deleteCategory(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/transactions/categories/${id}`);
  }

  async getStats(period: '30d' | '90d' | '1y' = '30d'): Promise<ApiResponse<TransactionStats>> {
    return apiClient.get(`/transactions/analytics/summary?period=${period}`);
  }

  async createTransfer(transferData: {
    fromWallet: 'life' | 'emergency' | 'portfolio';
    toWallet: 'life' | 'emergency' | 'portfolio';
    amount: number;
    currency: string;
    date: string | Date;
    notes?: string;
  }): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const payload = {
        from_wallet: transferData.fromWallet,
        to_wallet: transferData.toWallet,
        amount: transferData.amount,
        currency: transferData.currency || 'TWD',
        transaction_date: transferData.date instanceof Date
          ? transferData.date.toISOString().split('T')[0]
          : new Date(transferData.date).toISOString().split('T')[0],
        notes: transferData.notes || null
      };

      log.debug('Creating wallet transfer', payload, 'TransactionService');
      const response = await apiClient.post('/transactions/transfer', payload);

      return {
        data: response.data as Record<string, unknown> | undefined,
        message: 'Transfer created successfully',
        success: true
      };
    } catch (error: unknown) {
      log.apiError('POST', '/transactions/transfer', error);
      throw error;
    }
  }

  /** Fetch both legs of a wallet transfer as a single editable unit. */
  async getTransfer(groupId: string): Promise<ApiResponse<{
    transferGroupId: string;
    fromWallet: 'life' | 'emergency';
    toWallet: 'life' | 'emergency';
    amount: number;
    currency: string;
    date: string;
    notes?: string;
  }>> {
    try {
      // apiClient already unwraps the {success, message, data} envelope —
      // response.data here is the transfer dict itself, not the whole body.
      const response = await apiClient.get(`/transactions/transfer/${groupId}`);
      const data = response.data as Record<string, unknown> | undefined;

      if (!data) {
        return {
          data: null as unknown as never,
          message: 'Transfer not found',
          success: false
        };
      }

      return {
        data: {
          transferGroupId: data.transfer_group_id as string,
          fromWallet: data.from_wallet as 'life' | 'emergency',
          toWallet: data.to_wallet as 'life' | 'emergency',
          amount: data.amount as number,
          currency: data.currency as string,
          date: data.transaction_date as string,
          notes: data.notes as string | undefined
        },
        message: 'Transfer retrieved successfully',
        success: true
      };
    } catch (error: unknown) {
      log.apiError('GET', `/transactions/transfer/${groupId}`, error);
      return {
        data: null as unknown as never,
        message: 'Failed to retrieve transfer',
        success: false
      };
    }
  }

  /** Update both legs of an existing wallet transfer atomically. */
  async updateTransfer(groupId: string, transferData: {
    fromWallet: 'life' | 'emergency';
    toWallet: 'life' | 'emergency';
    amount: number;
    currency: string;
    date: string | Date;
    notes?: string;
  }): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const payload = {
        from_wallet: transferData.fromWallet,
        to_wallet: transferData.toWallet,
        amount: transferData.amount,
        currency: transferData.currency || 'TWD',
        transaction_date: transferData.date instanceof Date
          ? transferData.date.toISOString().split('T')[0]
          : new Date(transferData.date).toISOString().split('T')[0],
        notes: transferData.notes || null
      };

      log.debug('Updating wallet transfer', { groupId, payload }, 'TransactionService');
      const response = await apiClient.put(`/transactions/transfer/${groupId}`, payload);

      return {
        data: response.data as Record<string, unknown> | undefined,
        message: 'Transfer updated successfully',
        success: true
      };
    } catch (error: unknown) {
      log.apiError('PUT', `/transactions/transfer/${groupId}`, error);
      throw error;
    }
  }

  async getRecurringTransactions(): Promise<ApiResponse<Transaction[]>> {
    return apiClient.get('/transactions/recurring');
  }

  async createRecurringTransaction(
    transaction: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<Transaction>> {
    return apiClient.post('/transactions/', { ...transaction, is_recurring: true });
  }

  async scanReceipt(file: File): Promise<ApiResponse<Partial<Transaction>>> {
    return apiClient.upload('/transactions/scan-receipt', file);
  }

  async exportTransactions(
    filters: TransactionFilters = {},
    format: 'csv' | 'pdf' = 'csv'
  ): Promise<Blob> {
    const params = new URLSearchParams({ format });

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (key === 'dateRange' && typeof value === 'object') {
          params.append('startDate', value.start.toISOString());
          params.append('endDate', value.end.toISOString());
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const response = await apiClient.get(`/transactions/export?${params.toString()}`);
    return new Blob([JSON.stringify(response)], { type: 'application/json' });
  }

  async downloadCSV(dateFrom?: string, dateTo?: string): Promise<void> {
    const { getSession } = await import('next-auth/react');
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const baseUrl = getPublicApiUrl();
    const url = `${baseUrl}/transactions/export/csv?${params.toString()}`;

    const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
    try {
      const session = await getSession();
      const token = (session as { accessToken?: string } | null)?.accessToken;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* no session */ }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `transactions_${dateFrom ?? 'all'}_${dateTo ?? 'time'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }
}

export const transactionService = new TransactionService();