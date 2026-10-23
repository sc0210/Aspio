/**
 * useAdminData: the admin page's loader and actions, driven through a fake
 * fetch that routes on "METHOD path".
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useAdminData } from '@/hooks/useAdminData';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('react-hot-toast', () => {
  const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
  return { __esModule: true, default: t, toast: t };
});

const toastMock = toast as unknown as { success: jest.Mock; error: jest.Mock };

type Reply = { status?: number; body?: unknown };
let routes: Record<string, Reply>;
const calls: string[] = [];

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const key = `${init?.method ?? 'GET'} ${url}`;
  calls.push(key);
  const match = routes[key] ?? routes[`${init?.method ?? 'GET'} ${url.split('?')[0]}`];
  const { status = 200, body = {} } = match ?? { status: 404, body: { detail: `no route ${key}` } };
  return { ok: status < 400, status, json: async () => body } as Response;
});

const users = [
  { id: 'u1', email: 'a@x', is_active: true },
  { id: 'u2', email: 'b@x', is_active: true },
];
const pending = [{ id: 'p1' }, { id: 'p2' }];

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  global.fetch = fetchMock as unknown as typeof fetch;
  routes = {
    'GET /api/admin/check': { body: { isAdmin: true } },
    'GET /api/admin/stats/system': { body: { total_users: 2 } },
    'GET /api/admin/users': { body: { users, total: 120 } },
    'GET /api/admin/pending-users': { body: { users: pending } },
    'GET /api/admin/stats/database': { body: { tables: [] } },
  };
});

async function loaded() {
  const hook = renderHook(() => useAdminData());
  await act(() => hook.result.current.loadData());
  return hook;
}

describe('loadData', () => {
  it('loads stats, the first user page, pending users and db stats', async () => {
    const { result } = await loaded();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.stats).toEqual({ total_users: 2 });
    expect(result.current.users).toEqual(users);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pendingUsers).toEqual(pending);
    expect(result.current.dbStats).toEqual({ tables: [] });
    expect(calls).toContain('GET /api/admin/users?page=1&limit=50');
  });

  it('sends a non-admin to the dashboard', async () => {
    routes['GET /api/admin/check'] = { body: { isAdmin: false } };
    const { result } = await loaded();
    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(result.current.stats).toBeNull();
  });

  it('surfaces a failed required load as an error', async () => {
    routes['GET /api/admin/stats/system'] = { status: 500 };
    const { result } = await loaded();
    expect(result.current.error).toBe('Failed to load system stats');
  });

  it('tolerates missing optional sections', async () => {
    routes['GET /api/admin/pending-users'] = { status: 500 };
    routes['GET /api/admin/stats/database'] = { status: 500 };
    routes['GET /api/admin/users'] = { body: { users } };
    const { result } = await loaded();
    expect(result.current.pendingUsers).toEqual([]);
    expect(result.current.totalUsers).toBe(2);
  });
});

describe('search, filter and paging', () => {
  it('builds the query from search, status and page', async () => {
    const { result } = await loaded();

    act(() => result.current.setSearchQuery('  bob  '));
    await act(async () => result.current.handleSearchSubmit({ preventDefault: jest.fn() } as never));
    expect(calls).toContain('GET /api/admin/users?search=bob&page=1&limit=50');

    await act(async () => result.current.handleStatusFilterChange('inactive'));
    expect(calls).toContain('GET /api/admin/users?search=bob&is_active=false&page=1&limit=50');

    await act(async () => result.current.goToPage(2));
    expect(result.current.page).toBe(2);
    expect(calls).toContain('GET /api/admin/users?search=bob&is_active=false&page=2&limit=50');
  });
});

describe('user actions', () => {
  it('toggles a user active flag', async () => {
    routes['PATCH /api/admin/users/u1'] = { body: { is_active: false } };
    const { result } = await loaded();
    await act(() => result.current.handleToggleActive('u1'));
    expect(result.current.users[0].is_active).toBe(false);
    expect(toastMock.success).toHaveBeenCalledWith('User deactivated');
    expect(result.current.deactivating).toBeNull();
  });

  it('reports the server detail when a toggle fails', async () => {
    routes['PATCH /api/admin/users/u1'] = { status: 403, body: { detail: 'cannot deactivate yourself' } };
    const { result } = await loaded();
    await act(() => result.current.handleToggleActive('u1'));
    expect(toastMock.error).toHaveBeenCalledWith('cannot deactivate yourself');
  });

  it('deletes a user and drops it from the selection', async () => {
    routes['DELETE /api/admin/users/u1'] = {};
    const { result } = await loaded();
    act(() => result.current.toggleUserSelection('u1', 'users'));
    await act(() => result.current.handleDeleteUser('u1'));
    expect(result.current.users.map((u) => u.id)).toEqual(['u2']);
    expect(result.current.selectedUsers.size).toBe(0);
  });

  it('keeps the user when delete fails', async () => {
    routes['DELETE /api/admin/users/u1'] = { status: 500, body: { message: 'locked' } };
    const { result } = await loaded();
    await act(() => result.current.handleDeleteUser('u1'));
    expect(result.current.users).toHaveLength(2);
    expect(toastMock.error).toHaveBeenCalledWith('locked');
  });

  it('approves and rejects pending users', async () => {
    routes['POST /api/admin/approve-user/p1'] = {};
    routes['POST /api/admin/reject-user/p2'] = { status: 500, body: {} };
    const { result } = await loaded();
    await act(() => result.current.handleApproveUser('p1'));
    await act(() => result.current.handleRejectUser('p2'));
    expect(result.current.pendingUsers.map((u) => u.id)).toEqual(['p2']);
    expect(toastMock.error).toHaveBeenCalledWith('Failed to reject user');

    routes['POST /api/admin/reject-user/p2'] = {};
    await act(() => result.current.handleRejectUser('p2'));
    expect(result.current.pendingUsers).toEqual([]);
  });
});

describe('selection and bulk actions', () => {
  it('select-all toggles between everything and nothing', async () => {
    const { result } = await loaded();
    act(() => result.current.toggleAllUsers('users'));
    expect(result.current.selectedUsers.size).toBe(2);
    act(() => result.current.toggleAllUsers('users'));
    expect(result.current.selectedUsers.size).toBe(0);
    act(() => result.current.toggleAllUsers('pending'));
    expect(result.current.selectedPending.size).toBe(2);
    act(() => result.current.clearSelectedPending());
    expect(result.current.selectedPending.size).toBe(0);
    act(() => result.current.toggleUserSelection('u1', 'users'));
    act(() => result.current.clearSelectedUsers());
    expect(result.current.selectedUsers.size).toBe(0);
  });

  it('bulk-approves the selected pending users', async () => {
    routes['POST /api/admin/bulk-approve'] = { body: { approved: ['p1', 'p2'] } };
    const { result } = await loaded();
    await act(() => result.current.handleBulkApprove()); // nothing selected: no request
    expect(calls).not.toContain('POST /api/admin/bulk-approve');

    act(() => result.current.toggleAllUsers('pending'));
    await act(() => result.current.handleBulkApprove());
    expect(result.current.pendingUsers).toEqual([]);
    expect(toastMock.success).toHaveBeenCalledWith('Approved 2 users');
  });

  it('bulk-deletes users or pending users', async () => {
    routes['POST /api/admin/bulk-delete'] = { body: {} };
    const { result } = await loaded();
    act(() => result.current.toggleUserSelection('u2', 'users'));
    await act(() => result.current.handleBulkDelete('users'));
    expect(result.current.users.map((u) => u.id)).toEqual(['u1']);
    expect(toastMock.success).toHaveBeenCalledWith('Deleted 1 users');

    act(() => result.current.toggleUserSelection('p1', 'pending'));
    await act(() => result.current.handleBulkDelete('pending'));
    expect(result.current.pendingUsers.map((u) => u.id)).toEqual(['p2']);
  });

  it('reports a failed bulk action and stops processing', async () => {
    routes['POST /api/admin/bulk-delete'] = { status: 500, body: { detail: 'nope' } };
    const { result } = await loaded();
    act(() => result.current.toggleUserSelection('u1', 'users'));
    await act(() => result.current.handleBulkDelete('users'));
    expect(toastMock.error).toHaveBeenCalledWith('nope');
    expect(result.current.bulkProcessing).toBe(false);
    expect(result.current.users).toHaveLength(2);
  });
});

describe('vacuum', () => {
  it('vacuums one table and refreshes db stats', async () => {
    routes['POST /api/admin/database/vacuum?table=transactions'] = { body: { duration_s: 1.5, timestamp: 't' } };
    const { result } = await loaded();
    routes['GET /api/admin/stats/database'] = { body: { tables: ['fresh'] } };

    await act(() => result.current.handleVacuum('transactions'));

    expect(result.current.vacuumResults).toEqual({ transactions: { duration_s: 1.5, timestamp: 't' } });
    expect(result.current.dbStats).toEqual({ tables: ['fresh'] });
    expect(toastMock.success).toHaveBeenCalledWith('Vacuumed "transactions" in 1.5s');
  });

  it('vacuums everything and reports failures', async () => {
    routes['POST /api/admin/database/vacuum'] = { body: { duration_s: 3, timestamp: 't' } };
    const { result } = await loaded();
    await act(() => result.current.handleVacuum());
    expect(result.current.vacuumResults.all.duration_s).toBe(3);

    routes['POST /api/admin/database/vacuum'] = { status: 500, body: {} };
    await act(() => result.current.handleVacuum());
    expect(toastMock.error).toHaveBeenCalledWith('Vacuum failed');
    await waitFor(() => expect(result.current.vacuuming).toBeNull());
  });
});
