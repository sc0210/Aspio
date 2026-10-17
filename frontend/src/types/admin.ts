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
