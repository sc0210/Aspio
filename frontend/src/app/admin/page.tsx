'use client';

import React, { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import {
  UsersIcon,
  ChartBarIcon,
  CircleStackIcon,
  ClockIcon,
  ServerIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserPlusIcon,
  BellAlertIcon,
  ChartPieIcon,
  ArrowTrendingUpIcon,
  ExclamationTriangleIcon,
  CpuChipIcon,
  BoltIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  TableCellsIcon,
  WifiIcon,
  ExclamationCircleIcon,
  CloudArrowUpIcon,
  CloudArrowDownIcon,
  CommandLineIcon,
} from '@heroicons/react/24/outline';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON } from '@/components/layout/topBarStyles';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/utils/cn';
import { useAdminData } from '@/hooks/useAdminData';
import { apiClient } from '@/lib/api-client';
import type { TableStat, IndexStat, ActiveConnection } from '@/types/admin';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimeAgo(dateString: string, compact = false): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (compact) {
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  }
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getAvatarInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-purple-500 to-violet-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-purple-600',
  'from-lime-500 to-green-600',
];

function getAvatarColor(id: string): string {
  const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { t } = useTranslation(['admin']);
  const { status } = useAuthContext();
  const router = useRouter();

  // UI-only state — data state lives in useAdminData
  const [activeTab, setActiveTab] = useState('overview');
  const [pendingBulkDeleteType, setPendingBulkDeleteType] = useState<'users' | 'pending' | null>(null);
  const [pendingVacuumAll, setPendingVacuumAll] = useState(false);

  const {
    stats, dbStats, loading, error, loadData,
    users, selectedUsers, searchQuery, setSearchQuery,
    statusFilter, deactivating, deleting, pendingDeleteId, setPendingDeleteId,
    page, totalUsers, totalPages, goToPage,
    handleSearchSubmit, handleStatusFilterChange,
    handleToggleActive, handleDeleteUser,
    toggleUserSelection, toggleAllUsers, clearSelectedUsers,
    pendingUsers, selectedPending, approving, rejecting,
    pendingRejectId, setPendingRejectId, bulkProcessing,
    handleApproveUser, handleRejectUser, handleBulkApprove, handleBulkDelete,
    clearSelectedPending,
    vacuuming, vacuumResults, handleVacuum,
  } = useAdminData();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
    if (status === 'authenticated') {
      loadData();
    }
  }, [status, router, loadData]);

  // ── Formatters ────────────────────────────────────────────────────────────

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout topBarActions={
      !loading && !error ? (
        <button
          onClick={loadData}
          className={TOP_BAR_BUTTON}
        >
          <ArrowPathIcon className="w-4 h-4" />
          {t('admin:refresh')}
        </button>
      ) : undefined
    }>
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-3">
            <ShieldCheckIcon className="w-10 h-10 text-primary-500 dark:text-primary-400 mx-auto" />
            <LoadingSpinner size="lg" className="mx-auto text-primary-700 dark:text-primary-400" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin:loading')}</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-64">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-error-200 dark:border-error-800 p-8 max-w-md w-full text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-error-100 dark:bg-error-900/30 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-7 h-7 text-error-700 dark:text-error-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('admin:accessDenied')}</h3>
            <p className="text-sm text-error-700 dark:text-error-400 mb-6">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="px-5 py-2 bg-primary-700 hover:bg-primary-800 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              {t('admin:returnToDashboard')}
            </button>
          </div>
        </div>
      ) : (
      <div className="space-y-6">

        <PageHeader title={t('admin:title')} accent="blue" />

        {/* Pending approval alert */}
        {pendingUsers.length > 0 && (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-2xl p-4 border border-orange-200 dark:border-orange-800 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                <BellAlertIcon className="w-5 h-5 text-orange-700 dark:text-orange-400 animate-pulse" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">{t('admin:pendingBanner')}</p>
                <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                  {pendingUsers.length} {pendingUsers.length === 1 ? 'user is' : 'users are'} waiting for admin approval
                </p>
              </div>
              <button
                onClick={() => setActiveTab('pending')}
                className="px-4 py-2 bg-orange-700 hover:bg-orange-800 dark:bg-orange-500 dark:hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                {t('admin:reviewNow')}
              </button>
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <Card padding="none" className="p-1.5">
          <nav className="flex gap-1 overflow-x-auto">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={ChartBarIcon} label="Overview" />
            <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={UsersIcon} label="Users" badge={stats?.total_users ?? users.length} />
            <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')} icon={UserPlusIcon} label="Pending" badge={pendingUsers.length} badgeColor="orange" />
            <TabButton active={activeTab === 'database'} onClick={() => setActiveTab('database')} icon={CircleStackIcon} label="Database" />
          </nav>
        </Card>

        {/* ── Overview tab ── */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title={t('admin:stats.totalUsers')} value={stats.total_users || 0} subtitle={`${stats.active_users || 0} active`} icon={UsersIcon} trend={{ value: stats.new_users_this_week || 0, label: 'This week' }} color="blue" />
              <MetricCard title={t('admin:stats.portfolios')} value={stats.total_portfolios || 0} subtitle={`${stats.total_holdings || 0} holdings`} icon={ChartPieIcon} color="purple" />
              <MetricCard title={t('admin:stats.totalValue')} value={formatCurrency(stats.total_portfolio_value_usd || 0)} subtitle={t('admin:stats.portfolioAssets')} icon={ArrowTrendingUpIcon} color="green" isLarge />
              <MetricCard title={t('admin:stats.transactions')} value={stats.total_transactions || 0} subtitle={t('admin:stats.allTime')} icon={BoltIcon} color="amber" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SystemHealthCard title={t('admin:stats.uptime')} value={formatUptime(stats.uptime_seconds || 0)} subtitle={t('admin:stats.runningSmoothly')} icon={ServerIcon} status="success" />
              <SystemHealthCard title={t('admin:stats.cacheHitRate')} value={`${((stats.cache_hit_rate || 0) * 100).toFixed(1)}%`} subtitle={stats.cache_hit_rate >= 0.8 ? 'Optimal' : 'Needs attention'} icon={CpuChipIcon} status={stats.cache_hit_rate >= 0.8 ? 'success' : 'warning'} />
              <SystemHealthCard title={t('admin:stats.dbSize')} value={`${(stats.database_size_mb || 0).toFixed(2)} MB`} subtitle={t('admin:stats.totalStorage')} icon={CircleStackIcon} status="info" />
            </div>

            {/* Registration snapshot */}
            <Card padding="lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('admin:registrationSnapshot')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Today', value: stats.new_users_today || 0, color: 'bg-blue-500' },
                  { label: 'This week', value: stats.new_users_this_week || 0, color: 'bg-purple-500' },
                  { label: 'Pending approval', value: pendingUsers.length, color: 'bg-orange-500' },
                  { label: 'Inactive accounts', value: (stats.total_users || 0) - (stats.active_users || 0), color: 'bg-gray-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                    <div className={cn('w-2 h-2 rounded-full mb-2', color)} />
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ── Users tab ── */}
        {activeTab === 'users' && (
          <Card padding="none" clip>
            {/* Search & filter bar */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                <div className="flex flex-col sm:flex-row gap-3 flex-1">
                  <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={t('admin:searchPlaceholder')}
                      aria-label={t('admin:searchPlaceholder')}
                      className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500 text-gray-900 dark:text-white placeholder-gray-400"
                    />
                  </form>
                  <div className="flex gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-1">
                    {(['all', 'active', 'inactive'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => handleStatusFilterChange(f)}
                        className={cn(
                          'px-3 py-1 text-xs font-semibold rounded-md transition-all duration-150',
                          statusFilter === f
                            ? 'bg-primary-700 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                        )}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {selectedUsers.size > 0 && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{selectedUsers.size} selected</span>
                    {pendingBulkDeleteType === 'users' ? (
                      <>
                        <span className="text-xs text-gray-600 dark:text-gray-400">Delete {selectedUsers.size} {selectedUsers.size === 1 ? 'user' : 'users'}?</span>
                        <button
                          onClick={() => { setPendingBulkDeleteType(null); handleBulkDelete('users'); }}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors"
                        >{t('admin:yes')}</button>
                        <button
                          onClick={() => setPendingBulkDeleteType(null)}
                          className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                        >No</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setPendingBulkDeleteType('users')}
                        disabled={bulkProcessing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                        {t('admin:deleteSelected')}
                      </button>
                    )}
                    <button onClick={clearSelectedUsers} className="text-xs text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1.5">
                      {t('admin:clear')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {users.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                  <UsersIcon className="w-8 h-8 text-gray-500 dark:text-gray-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('admin:noUsers')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {searchQuery || statusFilter !== 'all' ? 'Try adjusting your search or filter.' : 'No users are registered yet.'}
                </p>
              </div>
            ) : (
              <>
                <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {totalUsers} user{totalUsers !== 1 ? 's' : ''} total
                    {totalPages > 1 && ` · page ${page} of ${totalPages}`}
                  </p>
                </div>
                <div className="overflow-auto max-h-[28rem]">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="w-10 px-3 py-3">
                          <input
                            aria-label={t('admin:selectAllUsers', 'Select all users')}
                            type="checkbox"
                            checked={selectedUsers.size === users.length && users.length > 0}
                            onChange={() => toggleAllUsers('users')}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500"
                          />
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.user')}</th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.status')}</th>
                        <th className="hidden lg:table-cell px-6 py-3 text-right text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.portfolios')}</th>
                        <th className="hidden lg:table-cell px-6 py-3 text-right text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.transactions')}</th>
                        <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.joined')}</th>
                        <th className="hidden md:table-cell px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.lastLogin')}</th>
                        <th className="px-3 sm:px-6 py-3 text-right text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {users.map((user) => (
                        <tr
                          key={user.id}
                          className={cn(
                            'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150',
                            selectedUsers.has(user.id) && 'bg-primary-50/50 dark:bg-primary-900/10',
                            !user.is_active && 'opacity-60'
                          )}
                        >
                          <td className="w-10 px-3 py-3">
                            <input
                              aria-label={`${t('admin:selectUser', 'Select user')} ${user.email}`}
                              type="checkbox"
                              checked={selectedUsers.has(user.id)}
                              onChange={() => toggleUserSelection(user.id, 'users')}
                              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500"
                            />
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 shadow-sm', getAvatarColor(user.id))}>
                                <span className="text-xs font-bold text-white">{getAvatarInitials(user.full_name || user.email)}</span>
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">{user.email}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.full_name || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                            <UserStatusBadge isActive={user.is_active} />
                          </td>
                          <td className="hidden lg:table-cell px-6 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 text-right tabular-nums">
                            {user.portfolio_count ?? 0}
                          </td>
                          <td className="hidden lg:table-cell px-6 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 text-right tabular-nums">
                            {user.transaction_count ?? 0}
                          </td>
                          <td className="hidden sm:table-cell px-6 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                            <span title={new Date(user.created_at).toLocaleString()}>{formatTimeAgo(user.created_at)}</span>
                          </td>
                          <td className="hidden md:table-cell px-6 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                            {user.last_login_at
                              ? <span title={new Date(user.last_login_at).toLocaleString()}>{formatTimeAgo(user.last_login_at)}</span>
                              : <span className="text-gray-500 dark:text-gray-500 italic">{t('admin:never')}</span>
                            }
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap text-right">
                            {pendingDeleteId === user.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">{t('admin:deleteConfirm')}</span>
                                <button
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors"
                                >
                                  {t('admin:yes')}
                                </button>
                                <button
                                  onClick={() => setPendingDeleteId(null)}
                                  className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleToggleActive(user.id)}
                                  disabled={deactivating === user.id || bulkProcessing}
                                  title={user.is_active ? 'Deactivate user' : 'Activate user'}
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
                                    user.is_active
                                      ? 'text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30'
                                      : 'text-success-700 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/30'
                                  )}
                                >
                                  {deactivating === user.id
                                    ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                    : user.is_active
                                      ? <NoSymbolIcon className="w-4 h-4" />
                                      : <CheckCircleIcon className="w-4 h-4" />
                                  }
                                  <span className="hidden sm:inline">{user.is_active ? 'Deactivate' : 'Activate'}</span>
                                </button>
                                <button
                                  onClick={() => setPendingDeleteId(user.id)}
                                  disabled={deleting || bulkProcessing}
                                  title={t('admin:deleteUser')}
                                  className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/30 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  <span className="hidden sm:inline">{t('admin:delete')}</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, totalUsers)} of {totalUsers}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => goToPage(page - 1)}
                        disabled={page <= 1}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >← Prev</button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                        .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('…');
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, idx) =>
                          p === '…' ? (
                            <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-500 dark:text-gray-400">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => goToPage(p as number)}
                              className={cn(
                                'w-8 h-8 text-xs font-semibold rounded-lg transition-colors',
                                page === p
                                  ? 'bg-primary-700 text-white'
                                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                              )}
                            >{p}</button>
                          )
                        )}
                      <button
                        onClick={() => goToPage(page + 1)}
                        disabled={page >= totalPages}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >{t('admin:next')}</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {/* ── Pending tab ── */}
        {activeTab === 'pending' && (
          <Card padding="none" clip>
            {pendingUsers.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-success-100 to-success-200 dark:from-success-900/30 dark:to-success-800/30 flex items-center justify-center">
                  <CheckCircleIcon className="w-8 h-8 text-success-700 dark:text-success-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('admin:allClear')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin:noPending')}</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border-b border-orange-200 dark:border-orange-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                        <UserPlusIcon className="w-5 h-5 text-orange-700 dark:text-orange-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('admin:pendingApprovals')}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          {pendingUsers.length} {pendingUsers.length === 1 ? 'user' : 'users'} waiting for review
                        </p>
                      </div>
                    </div>
                    {selectedPending.size > 0 && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{selectedPending.size} selected</span>
                        <button
                          onClick={handleBulkApprove}
                          disabled={bulkProcessing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-success-700 hover:bg-success-800 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          {t('admin:approveAll')}
                        </button>
                        {pendingBulkDeleteType === 'pending' ? (
                          <>
                            <span className="text-xs text-gray-600 dark:text-gray-400">Delete {selectedPending.size}?</span>
                            <button
                              onClick={() => { setPendingBulkDeleteType(null); handleBulkDelete('pending'); }}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors"
                            >{t('admin:yes')}</button>
                            <button
                              onClick={() => setPendingBulkDeleteType(null)}
                              className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                            >No</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setPendingBulkDeleteType('pending')}
                            disabled={bulkProcessing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                            {t('admin:deleteAll')}
                          </button>
                        )}
                        <button onClick={clearSelectedPending} className="text-xs text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1.5">
                          {t('admin:clear')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="overflow-auto max-h-[28rem]">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="w-10 px-3 py-3">
                          <input
                            aria-label={t('admin:selectAllPending', 'Select all pending users')}
                            type="checkbox"
                            checked={selectedPending.size === pendingUsers.length && pendingUsers.length > 0}
                            onChange={() => toggleAllUsers('pending')}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500"
                          />
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.user')}</th>
                        <th className="hidden md:table-cell px-6 py-3 text-left text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:registered')}</th>
                        <th className="px-3 sm:px-6 py-3 text-right text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:waiting')}</th>
                        <th className="px-3 sm:px-6 py-3 text-right text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('admin:usersTable.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {pendingUsers.map((user) => (
                        <tr
                          key={user.id}
                          className={cn(
                            'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150',
                            selectedPending.has(user.id) && 'bg-orange-50/50 dark:bg-orange-900/10'
                          )}
                        >
                          <td className="w-10 px-3 py-3">
                            <input
                              aria-label={`${t('admin:selectPendingUser', 'Select pending user')} ${user.email}`}
                              type="checkbox"
                              checked={selectedPending.has(user.id)}
                              onChange={() => toggleUserSelection(user.id, 'pending')}
                              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-700 dark:text-primary-600 focus-visible:ring-primary-500"
                            />
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 shadow-sm', getAvatarColor(user.id))}>
                                <span className="text-xs font-bold text-white">{getAvatarInitials(user.full_name || user.email)}</span>
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[140px] sm:max-w-xs">{user.email}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.full_name || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="hidden md:table-cell px-6 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                            <span title={new Date(user.created_at).toLocaleString()}>
                              {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap text-right">
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg',
                              parseInt(formatTimeAgo(user.created_at, true)) >= 1 && formatTimeAgo(user.created_at, true).endsWith('d')
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            )}>
                              <ClockIcon className="w-3 h-3" />
                              {formatTimeAgo(user.created_at, true)}
                            </span>
                          </td>
                          <td className="px-3 sm:px-6 py-3 whitespace-nowrap text-right">
                            {pendingRejectId === user.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">{t('admin:rejectConfirm')}</span>
                                <button
                                  onClick={() => handleRejectUser(user.id)}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-error-600 hover:bg-error-700 rounded-lg transition-colors"
                                >
                                  {t('admin:yes')}
                                </button>
                                <button
                                  onClick={() => setPendingRejectId(null)}
                                  className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                                <button
                                  onClick={() => handleApproveUser(user.id)}
                                  disabled={approving === user.id || rejecting === user.id || bulkProcessing}
                                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-success-600 to-success-700 hover:from-success-700 hover:to-success-800 rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                                >
                                  <CheckCircleIcon className="w-4 h-4" />
                                  <span className="hidden sm:inline">{approving === user.id ? 'Approving…' : 'Approve'}</span>
                                </button>
                                <button
                                  onClick={() => setPendingRejectId(user.id)}
                                  disabled={approving === user.id || rejecting === user.id || bulkProcessing}
                                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-semibold text-error-700 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/30 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed border border-error-200 dark:border-error-700"
                                >
                                  <XCircleIcon className="w-4 h-4" />
                                  <span className="hidden sm:inline">{rejecting === user.id ? 'Rejecting…' : 'Reject'}</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── Database tab ── */}
        {activeTab === 'database' && (
          <div className="space-y-6">

            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  label: 'Database Size',
                  value: dbStats?.total_size_mb ? `${dbStats.total_size_mb.toFixed(2)} MB` : '—',
                  icon: CircleStackIcon,
                  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                },
                {
                  label: 'Tables',
                  value: dbStats?.table_count ?? dbStats?.table_stats?.length ?? '—',
                  icon: TableCellsIcon,
                  color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
                },
                {
                  label: 'Indexes',
                  value: dbStats?.index_count ?? dbStats?.index_stats?.length ?? '—',
                  icon: ChartBarIcon,
                  color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
                },
                {
                  label: 'Buffer Hit %',
                  value: dbStats?.db_level?.buffer_hit_pct != null
                    ? `${dbStats!.db_level.buffer_hit_pct.toFixed(1)}%`
                    : '—',
                  icon: CpuChipIcon,
                  color: (dbStats?.db_level?.buffer_hit_pct ?? 0) >= 95
                    ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400'
                    : 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400',
                },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label} padding="md">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
                </Card>
              ))}
            </div>

            {/* DB-level activity stats */}
            {dbStats?.db_level && (
              <Card padding="lg">
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">{t('admin:db.activityCounters')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {[
                    { label: 'Active Connections', value: dbStats!.db_level.connections, warn: dbStats!.db_level.connections > 20 },
                    { label: 'Commits', value: (dbStats!.db_level.commits ?? 0).toLocaleString() },
                    { label: 'Rollbacks', value: (dbStats!.db_level.rollbacks ?? 0).toLocaleString(), warn: (dbStats!.db_level.rollbacks ?? 0) > 100 },
                    { label: 'Rows Inserted', value: (dbStats!.db_level.rows_inserted ?? 0).toLocaleString() },
                    { label: 'Deadlocks', value: dbStats!.db_level.deadlocks ?? 0, warn: (dbStats!.db_level.deadlocks ?? 0) > 0 },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className={cn('rounded-xl p-3 border', warn ? 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-800' : 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-700')}>
                      <p className={cn('text-xl font-bold tabular-nums', warn ? 'text-warning-700 dark:text-warning-300' : 'text-gray-900 dark:text-white')}>{value}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Data Cleanup */}
            <CleanupPanel />

            {/* Table stats */}
            {(dbStats?.table_stats?.length ?? 0) > 0 && (
              <Card padding="none" clip>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:db.tableStats')}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('admin:db.tableStatsHint')}</p>
                  </div>
                  {pendingVacuumAll ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">{t('admin:db.vacuumAll')}</span>
                      <button
                        onClick={() => { setPendingVacuumAll(false); handleVacuum(); }}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                      >{t('admin:db.yesProceed')}</button>
                      <button
                        onClick={() => setPendingVacuumAll(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                      >{t('admin:cancel')}</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setPendingVacuumAll(true)}
                      disabled={vacuuming !== null}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 rounded-lg transition-all shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {vacuuming === 'all'
                        ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                        : <ArrowPathIcon className="w-3.5 h-3.5" />
                      }
                      {vacuuming === 'all' ? 'Running…' : 'Vacuum All Tables'}
                    </button>
                  )}
                </div>
                <div className="overflow-auto max-h-[28rem]">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.table')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.totalSize')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.indexSize')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.liveRows')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.deadRows')}</th>
                        <th className="hidden lg:table-cell px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.cols')}</th>
                        <th className="hidden lg:table-cell px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.seqScans')}</th>
                        <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.lastVacuum')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.action')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {dbStats?.table_stats?.map((stat: TableStat) => {
                        const bloatRisk = stat.dead_rows > 0 && stat.live_rows > 0 && stat.dead_rows / stat.live_rows > 0.2;
                        const hasDeadRows = (stat.dead_rows ?? 0) > 0;
                        const isVacuuming = vacuuming === stat.table;
                        const lastResult = vacuumResults[stat.table];
                        return (
                          <tr key={stat.table} className={cn(
                            'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                            bloatRisk && 'bg-warning-50/30 dark:bg-warning-900/10'
                          )}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{stat.table}</span>
                                {bloatRisk && (
                                  <span title={t('admin:db.highDeadRows')} className="text-warning-700 dark:text-warning-500">
                                    <ExclamationCircleIcon className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right tabular-nums font-medium">{stat.total_size}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right tabular-nums">{stat.index_size}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right tabular-nums">{(stat.live_rows ?? 0).toLocaleString()}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              <span className={cn(
                                'text-sm tabular-nums',
                                bloatRisk ? 'font-semibold text-warning-700 dark:text-warning-400' : 'text-gray-500 dark:text-gray-400'
                              )}>
                                {(stat.dead_rows ?? 0).toLocaleString()}
                              </span>
                            </td>
                            <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right tabular-nums">{stat.column_count}</td>
                            <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right tabular-nums">{(stat.seq_scans ?? 0).toLocaleString()}</td>
                            <td className="hidden xl:table-cell px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                              {lastResult ? (
                                <span className="text-success-700 dark:text-success-400 font-medium">
                                  ✓ took {lastResult.duration_s}s
                                </span>
                              ) : stat.last_autovacuum ? (
                                new Date(stat.last_autovacuum).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              ) : (
                                <span className="italic text-gray-500 dark:text-gray-600">{t('admin:neverLower')}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              {hasDeadRows || bloatRisk ? (
                                <button
                                  onClick={() => handleVacuum(stat.table)}
                                  disabled={vacuuming !== null}
                                  title={`VACUUM ANALYZE ${stat.table}`}
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                                    bloatRisk
                                      ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50'
                                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                  )}
                                >
                                  {isVacuuming
                                    ? <ArrowPathIcon className="w-3 h-3 animate-spin" />
                                    : <ArrowPathIcon className="w-3 h-3" />
                                  }
                                  {isVacuuming ? 'Running…' : 'Vacuum'}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Index stats */}
            {(dbStats?.index_stats?.length ?? 0) > 0 && (
              <Card padding="none" clip>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:db.indexUsage')}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('admin:db.orderedBySize')}</p>
                  </div>
                  {(dbStats!.unused_indexes?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 rounded-full">
                      <ExclamationCircleIcon className="w-3.5 h-3.5" />
                      {dbStats!.unused_indexes!.length} unused
                    </span>
                  )}
                </div>
                <div className="overflow-auto max-h-[28rem]">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.index')}</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.table')}</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.type')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.size')}</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.scans')}</th>
                        <th className="hidden lg:table-cell px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.tuplesRead')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {dbStats!.index_stats!.map((idx: IndexStat) => {
                        const unused = idx.scans === 0;
                        return (
                          <tr key={`${idx.table}-${idx.index}`} className={cn('hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors', unused && 'bg-warning-50/40 dark:bg-warning-900/10')}>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-mono text-gray-900 dark:text-white">{idx.index}</span>
                                {unused && <span title={t('admin:db.neverUsed')} className="text-warning-700 dark:text-warning-500"><ExclamationCircleIcon className="w-3 h-3" /></span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono text-gray-500 dark:text-gray-400">{idx.table}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className="px-1.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                {idx.type?.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-700 dark:text-gray-300 text-right tabular-nums">{idx.size}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right">
                              <span className={cn('text-xs tabular-nums', unused ? 'text-warning-700 dark:text-warning-400 font-semibold' : 'text-gray-700 dark:text-gray-300')}>
                                {(idx.scans ?? 0).toLocaleString()}
                              </span>
                            </td>
                            <td className="hidden lg:table-cell px-4 py-2.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 text-right tabular-nums">
                              {(idx.tuples_read ?? 0).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Active connections */}
            {dbStats?.active_connections != null && (
              <Card padding="none" clip>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:db.activeConnections')}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{dbStats!.active_connections.length} session{dbStats!.active_connections.length !== 1 ? 's' : ''} listed</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('admin:db.live')}</span>
                  </div>
                </div>
                {dbStats!.active_connections.length === 0 ? (
                  <div className="px-6 py-8 text-center">
                    <WifiIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin:db.noConnections')}</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[28rem]">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.pid')}</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.userApp')}</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.state')}</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.duration')}</th>
                          <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('admin:db.query')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {dbStats!.active_connections.map((conn: ActiveConnection) => {
                          const slow = conn.duration_s > 5;
                          return (
                            <tr key={conn.pid} className={cn('hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors', slow && 'bg-red-50/40 dark:bg-red-900/10')}>
                              <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono text-gray-500 dark:text-gray-400">{conn.pid}</td>
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <p className="text-xs font-medium text-gray-900 dark:text-white">{conn.user}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{conn.application}</p>
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <ConnectionStateBadge state={conn.state} waitEvent={conn.wait_event} />
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                <span className={cn('text-xs tabular-nums font-mono', slow ? 'font-bold text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-gray-400')}>
                                  {conn.duration_s.toFixed(1)}s
                                </span>
                              </td>
                              <td className="hidden lg:table-cell px-4 py-2.5 max-w-xs">
                                <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">{conn.query || '—'}</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* Dev-only DB sync — only rendered in local development */}
            {process.env.NODE_ENV === 'development' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <DevDbSyncPanel target={REMOTE_SYNC_TARGET} />
                <DevDbSyncPanel target={PI_SYNC_TARGET} />
              </div>
            )}

          </div>
        )}

      </div>
      )}
    </DashboardLayout>
  );
}

// ─── CleanupPanel ─────────────────────────────────────────────────────────────

type CleanupPreview = {
  soft_deleted_transactions: number;
  soft_deleted_loans: number;
  stale_currency_rates: number;
  old_notifications: number;
  in_process_caches: number;
  demo_user_protected: boolean;
  notification_cutoff_days: number;
};

type CleanupResult = {
  soft_deleted_transactions: number;
  soft_deleted_loans: number;
  stale_currency_rates: number;
  old_notifications: number;
  price_cache_cleared: boolean;
  line_profile_cache_cleared: boolean;
};

function CleanupPanel() {
  const { t } = useTranslation(['admin']);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [previewError, setPreviewError] = useState<string>('');
  const [runState, setRunState] = useState<'idle' | 'confirming' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [runError, setRunError] = useState<string>('');

  const loadPreview = async () => {
    setPreviewState('loading');
    setPreviewError('');
    try {
      const res = await apiClient.get<CleanupPreview>('/admin/database/cleanup-preview');
      setPreview(res.data ?? null);
      setPreviewState('loaded');
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
      setPreviewState('error');
    }
  };

  const runCleanup = async () => {
    setRunState('running');
    setRunError('');
    try {
      const res = await apiClient.post<CleanupResult>('/admin/database/cleanup', {});
      setResult(res.data ?? null);
      setRunState('done');
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : 'Cleanup failed');
      setRunState('error');
    }
  };

  const reset = () => {
    setPreviewState('idle');
    setPreview(null);
    setPreviewError('');
    setRunState('idle');
    setResult(null);
    setRunError('');
  };

  const dbTotal = preview
    ? preview.soft_deleted_transactions + preview.soft_deleted_loans + preview.stale_currency_rates + preview.old_notifications
    : 0;

  return (
    <Card padding="none" clip>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <TrashIcon className="w-4 h-4 text-red-700 dark:text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{t('admin:cleanup.title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('admin:cleanup.subtitle')}
            </p>
          </div>
        </div>
        {(previewState !== 'idle' || runState !== 'idle') && (
          <button
            onClick={reset}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline transition-colors"
          >
            {t('admin:cleanup.reset')}
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">

        {/* Idle — show Preview button */}
        {previewState === 'idle' && (
          <button
            onClick={loadPreview}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
          >
            <TrashIcon className="w-4 h-4" />
            {t('admin:cleanup.preview')}
          </button>
        )}

        {/* Loading */}
        {previewState === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
            {t('admin:cleanup.scanning')}
          </div>
        )}

        {/* Preview error */}
        {previewState === 'error' && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
            <XCircleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{previewError}</p>
          </div>
        )}

        {/* Preview loaded */}
        {previewState === 'loaded' && preview && runState !== 'done' && (
          <div className="space-y-4">
            {/* Breakdown card */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 divide-y divide-gray-200 dark:divide-gray-700">
              {[
                { emoji: '🗑', label: 'Soft-deleted transactions', value: preview.soft_deleted_transactions },
                { emoji: '🗑', label: 'Soft-deleted loans', value: preview.soft_deleted_loans },
                { emoji: '📉', label: 'Stale currency rates', value: preview.stale_currency_rates },
                {
                  emoji: '🔔',
                  label: `Old notifications (${preview.notification_cutoff_days}d+)`,
                  value: preview.old_notifications,
                },
                { emoji: '⚡', label: 'In-process caches', value: preview.in_process_caches },
              ].map(({ emoji, label, value }) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {emoji} {label}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{value}</span>
                </div>
              ))}
            </div>

            {preview.demo_user_protected && (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                {t('admin:cleanup.demoProtected')}
              </p>
            )}

            {dbTotal === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('admin:cleanup.nothingToClean')}
              </p>
            )}

            {/* Run / Confirm / Cancel */}
            {runState === 'idle' && (
              <button
                onClick={() => setRunState('confirming')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                <TrashIcon className="w-4 h-4" />
                {t('admin:cleanup.run')}
              </button>
            )}

            {runState === 'confirming' && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">
                    This will permanently delete{' '}
                    <span className="font-bold">{dbTotal}</span> row{dbTotal !== 1 ? 's' : ''} and clear in-process caches. Are you sure?
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={runCleanup}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {t('admin:cleanup.confirmRun')}
                  </button>
                  <button
                    onClick={() => setRunState('idle')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {t('admin:cancel')}
                  </button>
                </div>
              </div>
            )}

            {runState === 'running' && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                {t('admin:cleanup.running')}
              </div>
            )}

            {runState === 'error' && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
                <XCircleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">{runError}</p>
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {runState === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 divide-y divide-green-100 dark:divide-green-800">
              {[
                { label: 'Soft-deleted transactions removed', value: result.soft_deleted_transactions },
                { label: 'Soft-deleted loans removed', value: result.soft_deleted_loans },
                { label: 'Stale currency rates removed', value: result.stale_currency_rates },
                { label: 'Old notifications removed', value: result.old_notifications },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                    <CheckCircleIcon className="w-4 h-4 shrink-0" />
                    {label}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-green-900 dark:text-green-200">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                  <CheckCircleIcon className="w-4 h-4 shrink-0" />
                  {t('admin:cleanup.priceCacheCleared')}
                </span>
                <span className="text-sm font-bold text-green-900 dark:text-green-200">
                  {result.price_cache_cleared ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                  <CheckCircleIcon className="w-4 h-4 shrink-0" />
                  {t('admin:cleanup.lineCacheCleared')}
                </span>
                <span className="text-sm font-bold text-green-900 dark:text-green-200">
                  {result.line_profile_cache_cleared ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            <button
              onClick={reset}
              className="text-sm text-primary-700 dark:text-primary-400 hover:underline font-medium"
            >
              {t('admin:cleanup.runAgain')}
            </button>
          </div>
        )}

      </div>
    </Card>
  );
}

// ─── DevDbSyncPanel ───────────────────────────────────────────────────────────

type SyncCommand = 'status' | 'push' | 'pull';
type SyncState = 'idle' | 'confirming' | 'running' | 'done' | 'error';

type SyncTarget = {
  title: string;
  subtitle: string;
  statusCmd: string;
  pushCmd: string;
  pullCmd: string;
  pushLabel: string;
  pullLabel: string;
  pushConfirm: string;
  pullConfirm: string;
};

const REMOTE_SYNC_TARGET: SyncTarget = {
  title: 'Dev DB Sync',
  subtitle: 'Local ↔ Supabase — only visible in development',
  statusCmd: 'status',
  pushCmd: 'push',
  pullCmd: 'pull',
  pushLabel: 'Push (local → remote)',
  pullLabel: 'Pull (remote → local)',
  pushConfirm: 'This will OVERWRITE the Supabase database with your local data',
  pullConfirm: 'This will ERASE your local database and replace it with remote data',
};

const PI_SYNC_TARGET: SyncTarget = {
  title: 'Raspberry Pi Sync',
  subtitle: 'Local ↔ Raspberry Pi (LAN) — only visible in development',
  statusCmd: 'status-pi',
  pushCmd: 'push-pi',
  pullCmd: 'pull-pi',
  pushLabel: 'Push (local → Pi)',
  pullLabel: 'Pull (Pi → local)',
  pushConfirm: 'This will OVERWRITE the Raspberry Pi database with your local data',
  pullConfirm: 'This will ERASE your local database and replace it with the Pi data',
};

function DevDbSyncPanel({ target }: { target: SyncTarget }) {
  const { t } = useTranslation(['admin']);
  const [state, setState] = useState<SyncState>('idle');
  const [pendingCmd, setPendingCmd] = useState<SyncCommand | null>(null);
  const [logs, setLogs] = useState<string>('');
  const logRef = React.useRef<HTMLPreElement>(null);

  const scrollLogs = () => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  };

  const runCommand = async (command: SyncCommand, confirmed = false) => {
    if ((command === 'push' || command === 'pull') && !confirmed) {
      setPendingCmd(command);
      setState('confirming');
      return;
    }

    setState('running');
    setLogs('');
    setPendingCmd(null);

    try {
      const backendCommand =
        command === 'status' ? target.statusCmd
        : command === 'push' ? target.pushCmd
        : target.pullCmd;
      const res = await fetch('/api/dev/db-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: backendCommand, confirmed: confirmed || command === 'status' }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => res.statusText);
        setState('error');
        setLogs(text);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setLogs(buf);
        scrollLogs();
      }

      const exitMatch = buf.match(/\[exit (\d+)\]/);
      setState(exitMatch && exitMatch[1] === '0' ? 'done' : 'error');
    } catch (err) {
      setState('error');
      setLogs(String(err));
    }
  };

  const reset = () => { setState('idle'); setLogs(''); setPendingCmd(null); };

  const confirmLabel: Record<SyncCommand, string> = {
    push: target.pushConfirm,
    pull: target.pullConfirm,
    status: '',
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
            <CommandLineIcon className="w-4 h-4 text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">{target.title}</h3>
            <p className="text-xs text-amber-700 dark:text-amber-400">{target.subtitle}</p>
          </div>
        </div>
        {(state === 'done' || state === 'error') && (
          <button
            onClick={reset}
            className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
          >
            {t('admin:clear')}
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Action buttons */}
        {state !== 'confirming' && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runCommand('status')}
              disabled={state === 'running'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {state === 'running' && pendingCmd === null
                ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                : <ArrowPathIcon className="w-3.5 h-3.5" />}
              {t('admin:usersTable.status')}
            </button>
            <button
              onClick={() => runCommand('pull')}
              disabled={state === 'running'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CloudArrowDownIcon className="w-3.5 h-3.5" />
              {target.pullLabel}
            </button>
            <button
              onClick={() => runCommand('push')}
              disabled={state === 'running'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CloudArrowUpIcon className="w-3.5 h-3.5" />
              {target.pushLabel}
            </button>
          </div>
        )}

        {/* Confirmation dialog */}
        {state === 'confirming' && pendingCmd && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-300">{confirmLabel[pendingCmd]}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runCommand(pendingCmd, true)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Yes, {pendingCmd === 'push' ? 'push' : 'pull'}
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t('admin:cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Log output */}
        {logs && (
          <pre
            ref={logRef}
            className="text-xs font-mono bg-gray-900 text-gray-100 rounded-xl p-4 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          >
            {logs}
          </pre>
        )}

        {/* Running indicator */}
        {state === 'running' && !logs && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
            {t('admin:cleanup.runningShort')}
          </div>
        )}

        {/* Result badge */}
        {state === 'done' && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success-700 dark:text-success-400">
            <CheckCircleIcon className="w-4 h-4" />
            {t('admin:cleanup.completed')}
          </div>
        )}
        {state === 'error' && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
            <XCircleIcon className="w-4 h-4" />
            {t('admin:cleanup.exitedWithError')}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function ConnectionStateBadge({ state, waitEvent }: { state: string; waitEvent?: string | null }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    active: { label: 'active', cls: 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300' },
    idle: { label: 'idle', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
    'idle in transaction': { label: 'idle in tx', cls: 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300' },
    'idle in transaction (aborted)': { label: 'aborted', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  };
  const { label, cls } = cfg[state] ?? { label: state, cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500' };
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('inline-block px-1.5 py-0.5 text-xs font-semibold rounded', cls)}>{label}</span>
      {waitEvent && <span className="text-xs text-gray-500 dark:text-gray-500">{waitEvent}</span>}
    </div>
  );
}

function UserStatusBadge({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation(['admin']);
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-bold rounded-lg bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300">
        <CheckCircleIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t('admin:active')}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
      <NoSymbolIcon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{t('admin:inactive')}</span>
    </span>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge, badgeColor = 'blue' }: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  badgeColor?: 'blue' | 'orange';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 min-w-fit px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200',
        active
          ? 'bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/40 dark:to-primary-800/30 text-primary-700 dark:text-primary-300 shadow-sm'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/50'
      )}
    >
      <div className="flex items-center justify-center gap-1.5 sm:gap-2">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="hidden sm:inline">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className={cn(
            'ml-0.5 sm:ml-1 px-1.5 sm:px-2 py-0.5 text-xs font-bold rounded-full',
            badgeColor === 'orange'
              ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
          )}>
            {badge}
          </span>
        )}
      </div>
    </button>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, trend, color, isLarge }: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: number; label: string };
  color: 'blue' | 'purple' | 'green' | 'amber';
  isLarge?: boolean;
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700',
    purple: 'from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700',
    green: 'from-success-500 to-success-600 dark:from-success-600 dark:to-success-700',
    amber: 'from-amber-500 to-amber-600 dark:from-amber-600 dark:to-amber-700',
  };

  return (
    <Card padding="lg" className="hover:shadow-lg transition-all duration-200">
      <div className="flex items-center justify-between mb-4">
        <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-lg', colorClasses[color])}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {trend && (
          <div className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg',
            trend.value > 0
              ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          )}>
            <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-bold">{trend.value > 0 ? '+' : ''}{trend.value}</span>
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</div>
      <div className={cn('font-bold text-gray-900 dark:text-white tabular-nums mb-1', isLarge ? 'text-2xl' : 'text-3xl')}>{value}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400">{trend ? trend.label : subtitle}</div>
    </Card>
  );
}

function SystemHealthCard({ title, value, subtitle, icon: Icon, status }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  status: 'success' | 'warning' | 'info';
}) {
  const statusConfig = {
    success: { gradient: 'from-success-500 to-success-600', bg: 'bg-success-50 dark:bg-success-900/20', text: 'text-success-700 dark:text-success-300', border: 'border-success-200 dark:border-success-800' },
    warning: { gradient: 'from-warning-500 to-warning-600', bg: 'bg-warning-50 dark:bg-warning-900/20', text: 'text-warning-700 dark:text-warning-300', border: 'border-warning-200 dark:border-warning-800' },
    info: { gradient: 'from-blue-500 to-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' },
  };
  const config = statusConfig[status];

  return (
    <div className={cn('rounded-2xl shadow-sm border p-6', config.bg, config.border)}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-lg', config.gradient)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <h3 className={cn('text-sm font-semibold', config.text)}>{title}</h3>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{value}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400">{subtitle}</p>
    </div>
  );
}
