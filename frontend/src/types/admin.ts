export interface SystemStats {
  total_users: number;
  active_users: number;
  new_users_today: number;
  new_users_this_week: number;
  total_portfolios: number;
  total_holdings: number;
  total_transactions: number;
  total_portfolio_value_usd: number;
  database_size_mb: number;
  cache_hit_rate: number;
  uptime_seconds: number;
  active_sessions: number;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
  portfolio_count?: number;
  transaction_count?: number;
}

export interface PendingUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  status: string;
}

export interface TableStat {
  table: string;
  total_size: string;
  index_size: string;
  live_rows: number;
  dead_rows: number;
  column_count: number;
  seq_scans: number;
  last_autovacuum?: string | null;
}

export interface IndexStat {
  index: string;
  table: string;
  type?: string;
  size: string;
  scans: number;
  tuples_read?: number;
}

export interface ActiveConnection {
  pid: number;
  user: string;
  application: string;
  state: string;
  wait_event?: string | null;
  duration_s: number;
  query?: string | null;
}

export interface DbLevelStats {
  buffer_hit_pct?: number;
  connections: number;
  commits?: number;
  rollbacks?: number;
  rows_inserted?: number;
  deadlocks?: number;
}

export interface DatabaseStats {
  total_size_mb?: number;
  table_count?: number;
  index_count?: number;
  table_stats?: TableStat[];
  index_stats?: IndexStat[];
  active_connections?: ActiveConnection[];
  unused_indexes?: IndexStat[];
  db_level?: DbLevelStats;
}

export type StatusFilter = 'all' | 'active' | 'inactive';
export type VacuumResult = { duration_s: number; timestamp: string };

// GET /admin/health/detailed
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type FeedStatus = 'fresh' | 'stale' | 'empty' | 'unknown';

export interface FeedFreshness {
  status: FeedStatus;
  latest: string | null;
  age_days: number | null;
  stale_after_days?: number;
}

export interface SystemHealth {
  status: HealthStatus;
  app: {
    version: string;
    commit: string;
    environment: string;
    uptime_seconds: number;
    line_bot_enabled: boolean;
  };
  database: {
    status: 'healthy' | 'unhealthy';
    latency_ms?: number;
    version?: string;
    size_mb?: number;
  };
  scheduler: {
    status: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
    enabled: boolean;
    running: boolean;
    jobs: { id: string; name: string; next_run: string | null }[];
  };
  data_freshness: Record<'wallet_snapshots' | 'historical_prices' | 'fx_rates', FeedFreshness>;
  timestamp: string;
}

// GET /admin/audit-logs
export interface AuditLogEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  error_message: string | null;
  admin_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}
