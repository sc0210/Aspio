/**
 * API Client for Aspiro FastAPI Backend
 * Provides type-safe communication between Next.js frontend and FastAPI backend
 */

import {
  User,
  Transaction,
  Notification,
  ApiResponse,
  PeerUserPreview,
  PeerConnectionOut,
  CompareDataResponse,
  SharedGoalOut,
  SharedGoalCreate,
  SavingRecord,
} from '@/shared/types';
import { getSession } from 'next-auth/react';
import { getPublicApiUrl, getServerApiUrl } from '@/lib/api-url';
export interface GamificationStats {
  user_id: string;
  level: number;
  experience_points: number;
  experience_to_next_level: number;
  total_achievements: number;
  achievements_by_rarity: Record<string, number>;
  streak_info: {
    current_login_streak: number;
    longest_login_streak: number;
    last_streak_update: string | null;
    streak_bonus_earned: number;
  };
  recent_achievements: AchievementItem[];
  digital_adoption_score: number;
  savings_discipline_score: number;
  investment_knowledge_score: number;
  community_engagement_score: number;
}

export interface AchievementItem {
  id: string;
  user_id: string;
  achievement_type: string;
  points_awarded: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  unlocked_at: string;
  title: string | null;
  description: string | null;
  icon: string | null;
  category: string | null;
}

export interface AchievementProgress {
  achievement_type: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  points_reward: number;
  current_progress: number;
  required_progress: number;
  progress_percentage: number;
  is_unlocked: boolean;
  unlocked_at: string | null;
  tips: string[];
}

export interface StreakUpdateResult {
  current_streak: number;
  longest_streak: number;
  streak_updated: boolean;
  new_achievements: AchievementItem[];
  streak_bonus_points?: number;
}

/**
 * A failure whose message the backend wrote for the user (its error envelope's
 * `error.message`, or a FastAPI string `detail`). Anything else that `upload()`
 * throws (a dropped connection, a timeout, the dev proxy's own 502) is a plain
 * Error whose message is not fit to show.
 */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  // Cached NextAuth session token — avoids a getSession() round-trip on every request.
  // Invalidated when the token is within 60 s of expiry or when clearAccessToken is called.
  private _cachedSessionToken: string | null = null;
  private _cachedSessionExpiry: number = 0; // Unix ms
  // The lookup in flight, shared so a page's first burst of queries makes one
  // /api/auth/session round-trip instead of one each.
  private _sessionLookup: Promise<string | null> | null = null;
  // Bumped by clearAccessToken(): a lookup started before a sign-out must not
  // put the old token back when it resolves.
  private _sessionGeneration = 0;

  constructor() {
    // Determine the API base URL based on environment
    this.baseUrl = this.getApiBaseUrl();
  }

  /**
   * Determine the API base URL based on environment:
   * - Server-side: absolute INTERNAL_API_URL (see `getServerApiUrl`)
   * - Browser with NEXT_PUBLIC_USE_PROXY=true: the /api/proxy route
   * - Browser otherwise: NEXT_PUBLIC_API_URL when set, else same-origin /api/v1
   *   (see `getPublicApiUrl` for the full rule)
   */
  private getApiBaseUrl(): string {
    const useProxy = process.env.NEXT_PUBLIC_USE_PROXY === 'true';

    // Server-side: use internal Docker network URL if available
    if (typeof window === 'undefined') {
      return getServerApiUrl();
    }

    // Client-side: only use proxy when explicitly opted in (e.g. local ngrok dev).
    // In production the app and /api/v1 share one origin behind Caddy, so the
    // browser calls the API directly and there is no CORS hop to make. The proxy
    // path exists for split-origin setups; routing through it adds a Next.js server
    // hop that returned 502s on slow backend operations.
    if (useProxy) {
      return '/api/proxy';
    }

    return getPublicApiUrl();
  }

  /**
   * Set access token for authenticated requests
   */
  setAccessToken(token: string) {
    this.accessToken = token;
  }

  /**
   * Clear access token and invalidate the session cache.
   */
  clearAccessToken() {
    this.accessToken = null;
    this._cachedSessionToken = null;
    this._cachedSessionExpiry = 0;
    this._sessionLookup = null;
    this._sessionGeneration += 1;
  }

  /**
   * Return the NextAuth session token, refreshing the cache only when it is
   * missing or within 60 seconds of expiry. This avoids a getSession() call
   * on every API request when the session is still valid.
   */
  private _getSessionToken(): Promise<string | null> {
    if (this._cachedSessionToken && Date.now() < this._cachedSessionExpiry - 60_000) {
      return Promise.resolve(this._cachedSessionToken);
    }
    if (!this._sessionLookup) {
      const lookup = this._lookUpSessionToken(this._sessionGeneration);
      this._sessionLookup = lookup;
      lookup.finally(() => {
        if (this._sessionLookup === lookup) this._sessionLookup = null;
      });
    }
    return this._sessionLookup;
  }

  private async _lookUpSessionToken(generation: number): Promise<string | null> {
    const nowMs = Date.now();
    const isCurrent = () => generation === this._sessionGeneration;
    try {
      const session = await getSession();
      const token = (session as { accessToken?: string; accessTokenExpires?: number } | null);
      if (token?.accessToken) {
        if (isCurrent()) {
          this._cachedSessionToken = token.accessToken;
          // accessTokenExpires is in seconds (JWT standard); fall back to 25-minute window
          this._cachedSessionExpiry = token.accessTokenExpires
            ? token.accessTokenExpires * 1000
            : nowMs + 25 * 60 * 1000;
        }
        return token.accessToken;
      }
    } catch {
      // Session fetch failed — fall through to internal token
    }
    if (isCurrent()) {
      this._cachedSessionToken = null;
      this._cachedSessionExpiry = 0;
    }
    return null;
  }

  /**
   * Check if user is authenticated (has a token)
   */
  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Get current mode (authenticated or demo)
   */
  get mode(): 'authenticated' | 'demo' {
    return this.accessToken ? 'authenticated' : 'demo';
  }

  /**
   * Make API request with optional authentication
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Skip ngrok browser warning for API calls
      'ngrok-skip-browser-warning': 'true',
      // Prevent browser caching of API responses
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(options.headers as Record<string, string>),
    };

    // Attach auth token — use cached session token to avoid getSession() overhead,
    // then fall back to the internal token set via setAccessToken().
    const sessionToken = await this._getSessionToken();
    const token = sessionToken || this.accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Extract custom timeout or use default (30 seconds)
    const timeoutMs = options.timeout || 30000;

    try {
      // Add timeout to fetch request to prevent indefinite hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      // Check if response exists
      if (!response) {
        throw new Error('No response received from server');
      }

      // Handle different response types
      const contentType = response.headers?.get('content-type');
      let data: unknown;

      // Handle empty responses (like 204 No Content)
      if (response?.status === 204 || response?.headers?.get('content-length') === '0') {
        data = {
          success: true,
          message: 'Success'
        };
      } else if (contentType?.includes('application/json')) {
        try {
          data = await response.json();
        } catch (error) {
          // Handle empty JSON response
          console.warn('Failed to parse JSON response, treating as empty:', error);
          data = {
            success: response.ok,
            message: response.ok ? 'Success' : `HTTP error! status: ${response.status}`
          };
        }
      } else {
        // For non-JSON responses, wrap in ApiResponse format
        data = {
          data: await response.text(),
          success: response.ok,
          message: response.ok ? 'Success' : `HTTP error! status: ${response.status}`
        };
      }

      if (!response.ok) {
        // For report endpoints that return 404 (not implemented yet), keep logging minimal
        const isReportEndpoint = endpoint.includes('/reports/');
        const is404 = response.status === 404;

        if (isReportEndpoint && is404) {
          // Silently handle 404s for report endpoints so UI can show explicit unavailable state
          if (process.env.NODE_ENV === 'development') {
            console.debug(`Report endpoint not implemented: ${endpoint}`);
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // In demo mode, throw authentication errors so services can handle fallback
        if (response.status === 401 && !this.accessToken) {
          console.warn('Demo mode: Authentication required, throwing error for service-level fallback handling.');
          throw new Error('Demo mode: Authentication required');
        }
        // Prefer the structured error message from the backend body (e.g. RateLimitException),
        // then fall back to the top-level message field, then the HTTP status.
        // For FastAPI 422 validation errors, extract field-level details from data.detail[].
        const dataObj = data as Record<string, unknown>;
        const detail422 = response.status === 422 && Array.isArray((dataObj)?.detail)
          ? (dataObj.detail as Array<{ loc?: unknown[]; msg: string }>).map((e) => {
              const field = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '';
              return field ? `${field}: ${e.msg}` : e.msg;
            }).join('; ')
          : null;
        throw new Error(
          detail422 ||
          (dataObj?.error as Record<string, unknown>)?.message as string ||
          dataObj?.message as string ||
          `HTTP error! status: ${response.status}`
        );
      }

      // Normalize response format
      if (data && typeof data === 'object' && 'data' in data) {
        return data as ApiResponse<T>;
      } else {
        // Wrap raw data in ApiResponse format
        return {
          data: data as T,
          success: true,
          message: 'Success'
        };
      }
    } catch (error) {
      // Handle abort timeout separately
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`API request timeout for ${endpoint} after ${timeoutMs / 1000}s (${this.mode} mode)`);
        throw new Error(`Request timeout: ${endpoint}`);
      }

      // Check if it's a 404 error for report endpoints (expected when not implemented)
      const is404 = error instanceof Error && error.message.includes('404');
      const isReportEndpoint = endpoint.includes('/reports/');

      if (is404 && isReportEndpoint) {
        // Completely silent for report endpoints - no logging at all
        throw error;
      } else if (is404) {
        // Use debug logging for other 404s
        if (process.env.NODE_ENV === 'development') {
          console.debug(`API endpoint not found: ${endpoint} (${this.mode} mode)`);
        }
        throw error;
      } else {
        // Log other errors normally
        console.error(`API request failed for ${endpoint} (${this.mode} mode):`, error);
        throw error;
      }
    }
  }

  // Generic HTTP methods
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown, options?: { timeout?: number }): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      timeout: options?.timeout,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  /**
   * Upload a file using multipart/form-data.
   * The file is sent as the `file` field; extra fields can be added via `fields`.
   */
  async upload<T>(
    endpoint: string,
    file: File,
    fields?: Record<string, string>,
    options?: { timeout?: number }
  ): Promise<ApiResponse<T>> {
    const form = new FormData();
    form.append('file', file);
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, value);
      }
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'ngrok-skip-browser-warning': 'true',
    };
    const sessionToken = await this._getSessionToken();
    const token = sessionToken || this.accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const timeoutMs = options?.timeout ?? 60_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The backend's error envelope carries the reason at error.message; `detail`
        // is a string only for a bare HTTPException (a validation error makes it an
        // array, which would print as "[object Object]").
        // A top-level `message` is not trusted as user-facing: the dev proxy's 502
        // puts "fetch failed" there.
        const errData = data as { error?: { message?: string }; detail?: unknown };
        const detail = typeof errData.detail === 'string' ? errData.detail : undefined;
        const serverMessage = errData.error?.message || detail;
        if (serverMessage) throw new ApiError(serverMessage, response.status);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return (data && typeof data === 'object' && 'data' in data)
        ? (data as ApiResponse<T>)
        : { data: data as T, success: true, message: 'Success' };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Upload timeout: ${endpoint}`);
      }
      throw error;
    }
  }

  // Authentication APIs
  async logout(refreshToken?: string): Promise<void> {
    await this.request('/auth/logout', {
      method: 'POST',
      body: refreshToken
        ? JSON.stringify({ refresh_token: refreshToken, logout_all_devices: false })
        : undefined,
    });
    this.clearAccessToken();
  }

  // User APIs
  async getCurrentUser(): Promise<User> {
    const response = await this.request<User>('/users/me');
    return response.data!;
  }

  async updateUser(userData: Partial<User>): Promise<User> {
    const response = await this.request<User>('/users/me', {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
    return response.data!;
  }

  /**
   * Update regional/localization preferences (preferred currency, language,
   * timezone). preferred_currency is the account default the add-transaction
   * form seeds from — distinct from the localStorage-only portfolio "base
   * currency". Backend: PUT /users/me/regional-preferences.
   */
  async updateRegionalPreferences(prefs: {
    preferred_currency?: string;
    preferred_language?: string;
    timezone?: string;
  }): Promise<User> {
    const response = await this.request<User>('/users/me/regional-preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
    return response.data!;
  }

  // Transaction APIs
  async updateTransaction(id: string, transaction: Partial<Transaction>): Promise<Transaction> {
    const response = await this.request<Transaction>(`/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(transaction),
    });
    return response.data!;
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.request(`/transactions/${id}`, { method: 'DELETE' });
  }

  // Notifications APIs
  async getNotifications(): Promise<Notification[]> {
    const response = await this.request<Notification[]>('/notifications/');
    return (response as unknown as { data: Notification[] }).data ?? [];
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await this.request(`/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'read', read_at: new Date().toISOString() }),
    });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.request('/notifications/mark-all-read', { method: 'POST' });
  }

  // Gamification APIs
  async getGamificationStats(): Promise<GamificationStats> {
    const response = await this.request<GamificationStats>('/users/me/gamification');
    return response.data!;
  }

  async getAchievementProgress(): Promise<AchievementProgress[]> {
    const response = await this.request<AchievementProgress[]>('/users/me/achievements/progress');
    return (response as unknown as { data: AchievementProgress[] }).data ?? [];
  }

  async updateLoginStreak(): Promise<StreakUpdateResult> {
    const response = await this.request<StreakUpdateResult>('/users/me/streak/update', {
      method: 'POST',
    });
    return (response as unknown as { data: StreakUpdateResult }).data;
  }

  async checkAllAchievements(): Promise<AchievementItem[]> {
    const response = await this.request<AchievementItem[]>('/users/me/achievements/check-all', {
      method: 'POST',
    });
    return (response as unknown as { data: AchievementItem[] }).data ?? [];
  }

  // Peer comparison
  async searchPeer(username: string): Promise<ApiResponse<PeerUserPreview | null>> {
    return this.get<PeerUserPreview | null>(`/peers/search?username=${encodeURIComponent(username)}`);
  }

  async sendPeerInvite(username: string): Promise<ApiResponse<PeerConnectionOut>> {
    return this.post<PeerConnectionOut>('/peers/invite', { username });
  }

  async getPeerConnections(): Promise<ApiResponse<PeerConnectionOut[]>> {
    return this.get<PeerConnectionOut[]>('/peers/');
  }

  async respondToPeerInvite(id: string, action: 'accept' | 'decline'): Promise<ApiResponse<PeerConnectionOut>> {
    return this.patch<PeerConnectionOut>(`/peers/${id}/respond`, { action });
  }

  async removePeerConnection(id: string): Promise<ApiResponse<null>> {
    return this.delete<null>(`/peers/${id}`);
  }

  async getPeerCompareData(): Promise<ApiResponse<CompareDataResponse>> {
    return this.get<CompareDataResponse>('/peers/compare-data');
  }

  async listSharedGoals(): Promise<ApiResponse<SharedGoalOut[]>> {
    return this.get<SharedGoalOut[]>('/peers/goals');
  }

  async createSharedGoal(data: SharedGoalCreate): Promise<ApiResponse<SharedGoalOut>> {
    return this.post<SharedGoalOut>('/peers/goals', data);
  }

  async deleteSharedGoal(goalId: string): Promise<ApiResponse<null>> {
    return this.delete<null>(`/peers/goals/${goalId}`);
  }

  async listSavingRecords(goalId: string): Promise<ApiResponse<SavingRecord[]>> {
    return this.get<SavingRecord[]>(`/peers/goals/${goalId}/records`);
  }

  async addSavingRecord(goalId: string, data: { amount: number; record_date: string; note?: string }): Promise<ApiResponse<SavingRecord>> {
    return this.post<SavingRecord>(`/peers/goals/${goalId}/records`, data);
  }

  async updateSavingRecord(goalId: string, recordId: string, data: { amount?: number; record_date?: string; note?: string | null }): Promise<ApiResponse<SavingRecord>> {
    return this.patch<SavingRecord>(`/peers/goals/${goalId}/records/${recordId}`, data);
  }

  async deleteSavingRecord(goalId: string, recordId: string): Promise<ApiResponse<null>> {
    return this.delete<null>(`/peers/goals/${goalId}/records/${recordId}`);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing
export { ApiClient };