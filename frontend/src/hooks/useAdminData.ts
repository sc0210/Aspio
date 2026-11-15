'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from './useDataSynchronization';
import toast from 'react-hot-toast';
import type {
  SystemStats,
  AdminUser,
  PendingUser,
  DatabaseStats,
  StatusFilter,
  VacuumResult,
} from '@/types/admin';
import type { AccessTier } from '@/lib/access';

const PAGE_SIZE = 50;

function buildUserParams(search: string, filter: StatusFilter, page: number, pageSize: number) {
  const p = new URLSearchParams();
  if (search.trim()) p.set('search', search.trim());
  if (filter !== 'all') p.set('is_active', filter === 'active' ? 'true' : 'false');
  p.set('page', String(page));
  p.set('limit', String(pageSize));
  return p;
}

export function useAdminData() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Users ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [settingTier, setSettingTier] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── Pending users ──────────────────────────────────────────────────────────
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<string | null>(null);
  // The tier picked beside each pending user's Approve button; unset means free.
  const [approvalTiers, setApprovalTiers] = useState<Record<string, AccessTier>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // ── Vacuum ─────────────────────────────────────────────────────────────────
  const [vacuuming, setVacuuming] = useState<string | null>(null);
  const [vacuumResults, setVacuumResults] = useState<Record<string, VacuumResult>>({});

  // Refs mirror the latest search/filter/page so loadData can read them without
  // depending on them (keeps loadData's identity stable). Written in an effect,
  // not during render — writing a ref during render is impure
  // (react-hooks/refs). loadData only runs from events/effects (after commit),
  // so the refs are always current by the time it reads them.
  const searchQueryRef = useRef(searchQuery);
  const statusFilterRef = useRef(statusFilter);
  const pageRef = useRef(page);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
    statusFilterRef.current = statusFilter;
    pageRef.current = page;
  }, [searchQuery, statusFilter, page]);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const checkRes = await fetch('/api/admin/check');
      const checkData = await checkRes.json();
      if (!checkData.isAdmin) {
        router.push('/dashboard');
        return;
      }

      const statsRes = await fetch('/api/admin/stats/system');
      if (!statsRes.ok) throw new Error('Failed to load system stats');
      setStats(await statsRes.json());

      const usersRes = await fetch(
        `/api/admin/users?${buildUserParams(searchQueryRef.current, statusFilterRef.current, pageRef.current, PAGE_SIZE)}`
      );
      if (!usersRes.ok) throw new Error('Failed to load users');
      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      setTotalUsers(usersData.total ?? usersData.users?.length ?? 0);

      const pendingRes = await fetch('/api/admin/pending-users');
      if (pendingRes.ok) setPendingUsers((await pendingRes.json()).users || []);

      const dbRes = await fetch('/api/admin/stats/database');
      if (dbRes.ok) setDbStats(await dbRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadUsers = useCallback(
    async (
      search = searchQueryRef.current,
      filter = statusFilterRef.current,
      targetPage = pageRef.current,
    ) => {
      const res = await fetch(`/api/admin/users?${buildUserParams(search, filter, targetPage, PAGE_SIZE)}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotalUsers(data.total ?? data.users?.length ?? 0);
      }
    },
    []
  );

  // ── User search / filter ───────────────────────────────────────────────────

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadUsers(searchQueryRef.current, statusFilterRef.current, 1);
  };

  const handleStatusFilterChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
    loadUsers(searchQueryRef.current, value, 1);
  };

  const goToPage = useCallback((targetPage: number) => {
    setPage(targetPage);
    loadUsers(searchQueryRef.current, statusFilterRef.current, targetPage);
  }, [loadUsers]);

  // ── User CRUD ──────────────────────────────────────────────────────────────

  const handleToggleActive = async (userId: string) => {
    try {
      setDeactivating(userId);
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'PATCH' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Failed to update user');
      }
      const data = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: data.is_active } : u));
      toast.success(data.is_active ? 'User activated' : 'User deactivated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setDeactivating(null);
    }
  };

  const handleSetAccessTier = async (userId: string, tier: AccessTier) => {
    try {
      setSettingTier(userId);
      const res = await fetch(`/api/admin/users/${userId}/access-tier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_tier: tier }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || err.detail || err.message || 'Failed to change plan');
      }
      const data = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, access_tier: data.access_tier } : u));
      // If that was the admin's own account, their sidebar and badge follow now
      // rather than on the next reload. Cheap either way: one profile refetch.
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.USER_PROFILE] });
      toast.success(data.access_tier === 'premium' ? 'Upgraded to Premium' : 'Moved to Free');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change plan');
    } finally {
      setSettingTier(null);
    }
  };

  const setApprovalTier = (userId: string, tier: AccessTier) =>
    setApprovalTiers(prev => ({ ...prev, [userId]: tier }));

  const handleDeleteUser = async (userId: string) => {
    setPendingDeleteId(null);
    try {
      setDeleting(true);
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Failed to delete user');
      }
      setUsers(prev => prev.filter(u => u.id !== userId));
      setSelectedUsers(prev => { const n = new Set(prev); n.delete(userId); return n; });
      toast.success('User deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  // ── Pending user actions ───────────────────────────────────────────────────

  const handleApproveUser = async (userId: string) => {
    try {
      setApproving(userId);
      const tier = approvalTiers[userId] ?? 'free';
      const res = await fetch(`/api/admin/approve-user/${userId}?access_tier=${tier}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Failed to approve user');
      }
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      toast.success('User approved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve user');
    } finally {
      setApproving(null);
    }
  };

  const handleRejectUser = async (userId: string) => {
    setPendingRejectId(null);
    try {
      setRejecting(userId);
      const res = await fetch(`/api/admin/reject-user/${userId}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Failed to reject user');
      }
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      toast.success('User rejected and removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject user');
    } finally {
      setRejecting(null);
    }
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleUserSelection = (userId: string, type: 'users' | 'pending') => {
    const setter = type === 'users' ? setSelectedUsers : setSelectedPending;
    setter(prev => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId); else n.add(userId);
      return n;
    });
  };

  const toggleAllUsers = (type: 'users' | 'pending') => {
    if (type === 'users') {
      setSelectedUsers(prev =>
        prev.size === users.length ? new Set() : new Set(users.map(u => u.id))
      );
    } else {
      setSelectedPending(prev =>
        prev.size === pendingUsers.length ? new Set() : new Set(pendingUsers.map(u => u.id))
      );
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const handleBulkApprove = async () => {
    if (selectedPending.size === 0) return;
    try {
      setBulkProcessing(true);
      const res = await fetch('/api/admin/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(selectedPending)),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Bulk approve failed');
      }
      const data = await res.json();
      const approvedIds = new Set(selectedPending);
      // Bulk approve has no per-user tier, so the rows set to Premium beside
      // their Approve button are upgraded right after; the rest stay free.
      const upgrades = Array.from(approvedIds).filter(id => approvalTiers[id] === 'premium');
      const upgraded = await Promise.all(upgrades.map(id =>
        fetch(`/api/admin/users/${id}/access-tier`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_tier: 'premium' }),
        }).then(r => r.ok, () => false)
      ));
      setPendingUsers(prev => prev.filter(u => !approvedIds.has(u.id)));
      setSelectedPending(new Set());
      toast.success(`Approved ${data.approved?.length || approvedIds.size} users`);
      const failed = upgraded.filter(ok => !ok).length;
      if (failed > 0) {
        toast.error(`${failed} approved as Free: the Premium upgrade failed. Set their plan on the Users tab.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk approve failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkDelete = async (type: 'users' | 'pending') => {
    const selected = type === 'users' ? selectedUsers : selectedPending;
    if (selected.size === 0) return;
    try {
      setBulkProcessing(true);
      const res = await fetch('/api/admin/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(selected)),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Bulk delete failed');
      }
      const data = await res.json();
      const deletedIds = new Set(selected);
      if (type === 'users') {
        setUsers(prev => prev.filter(u => !deletedIds.has(u.id)));
        setSelectedUsers(new Set());
      } else {
        setPendingUsers(prev => prev.filter(u => !deletedIds.has(u.id)));
        setSelectedPending(new Set());
      }
      toast.success(`Deleted ${data.deleted?.length || deletedIds.size} users`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  // ── Vacuum ─────────────────────────────────────────────────────────────────

  const handleVacuum = async (table?: string) => {
    const key = table || 'all';
    try {
      setVacuuming(key);
      const url = table
        ? `/api/admin/database/vacuum?table=${encodeURIComponent(table)}`
        : '/api/admin/database/vacuum';
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.message || 'Vacuum failed');
      }
      const data = await res.json();
      setVacuumResults(prev => ({ ...prev, [key]: { duration_s: data.duration_s, timestamp: data.timestamp } }));
      toast.success(table ? `Vacuumed "${table}" in ${data.duration_s}s` : `Vacuumed all tables in ${data.duration_s}s`);
      const dbRes = await fetch('/api/admin/stats/database');
      if (dbRes.ok) setDbStats(await dbRes.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vacuum failed');
    } finally {
      setVacuuming(null);
    }
  };

  const clearSelectedUsers = () => setSelectedUsers(new Set());
  const clearSelectedPending = () => setSelectedPending(new Set());

  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));

  return {
    // Stats & global
    stats, dbStats, loading, error, loadData,
    // Users
    users, selectedUsers, searchQuery, setSearchQuery,
    statusFilter, deactivating, deleting, pendingDeleteId, setPendingDeleteId,
    page, totalUsers, totalPages, goToPage,
    handleSearchSubmit, handleStatusFilterChange,
    handleToggleActive, handleDeleteUser,
    settingTier, handleSetAccessTier,
    toggleUserSelection, toggleAllUsers, clearSelectedUsers,
    // Pending users
    pendingUsers, selectedPending, approving, rejecting,
    approvalTiers, setApprovalTier,
    pendingRejectId, setPendingRejectId, bulkProcessing,
    handleApproveUser, handleRejectUser, handleBulkApprove, handleBulkDelete,
    clearSelectedPending,
    // Vacuum
    vacuuming, vacuumResults, handleVacuum,
  };
}
