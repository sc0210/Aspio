'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type {
  SystemStats,
  AdminUser,
  PendingUser,
  DatabaseStats,
  StatusFilter,
  VacuumResult,
} from '@/types/admin';

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
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── Pending users ──────────────────────────────────────────────────────────
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<string | null>(null);
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
      const res = await fetch(`/api/admin/approve-user/${userId}`, { method: 'POST' });
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
      setPendingUsers(prev => prev.filter(u => !approvedIds.has(u.id)));
      setSelectedPending(new Set());
      toast.success(`Approved ${data.approved?.length || approvedIds.size} users`);
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
    toggleUserSelection, toggleAllUsers, clearSelectedUsers,
    // Pending users
    pendingUsers, selectedPending, approving, rejecting,
    pendingRejectId, setPendingRejectId, bulkProcessing,
    handleApproveUser, handleRejectUser, handleBulkApprove, handleBulkDelete,
    clearSelectedPending,
    // Vacuum
    vacuuming, vacuumResults, handleVacuum,
  };
}
