/**
 * Demo-mode writes must never reach the backend.
 *
 * Transaction delete, goal create/contribute/delete and loan add/edit had no
 * demo guard: in demo they called the real API and failed (404 / 401) behind a
 * success-looking UI. Each now short-circuits — no network call, a "simulated"
 * toast, and the demo fixtures updated where they live in DemoContext.
 */

import { act, renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useAuthContext } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { apiClient } from '@/lib/api-client';
import { loanService } from '@/services/loanService';
import { useCreateGoal, useAddContribution, useDeleteGoal } from '@/hooks/useGoals';
import { useCreateLoan, useUpdateLoan } from '@/hooks/useLoans';
import { useDeleteTransaction } from '@/hooks/api-hooks';
import { createQueryWrapper } from '../utils/queryWrapper';
import i18n from '@/lib/i18n';

jest.mock('react-hot-toast', () => {
    // One object behind both the default and the named export: the hooks use both.
    const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() });
    return { __esModule: true, default: t, toast: t };
});

jest.mock('@/contexts/DemoContext', () => ({ useDemo: jest.fn() }));

jest.mock('@/lib/api-client', () => ({
    apiClient: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        deleteTransaction: jest.fn(),
        updateTransaction: jest.fn(),
    },
}));

jest.mock('@/services/loanService', () => ({
    loanService: {
        getLoans: jest.fn(),
        createLoan: jest.fn(),
        updateLoan: jest.fn(),
        deleteLoan: jest.fn(),
        recordPayment: jest.fn(),
        updatePayment: jest.fn(),
        deletePayment: jest.fn(),
        getPayments: jest.fn(),
    },
}));

const mockAuth = useAuthContext as jest.Mock;
const mockUseDemo = useDemo as jest.Mock;
const toastSuccess = (toast as unknown as { success: jest.Mock }).success;
// Whatever language the suite's i18n instance resolves to — the point is that
// the demo toast is shown, not the real "created/updated" one.
const simulated = () => i18n.t('common:demoAlert.changesSimulated');

const demoApi = {
    addDemoGoal: jest.fn(),
    updateDemoGoal: jest.fn(),
    removeDemoGoal: jest.fn(),
    removeDemoTransaction: jest.fn(),
    demoGoals: [{ id: 'g1', currentAmount: 1000, targetAmount: 5000 }],
    demoTransactions: [],
    demoRevision: 0,
    isDemoMode: true,
};

function setMode(isDemo: boolean) {
    mockAuth.mockReturnValue({
        mode: isDemo ? 'demo' : 'authenticated',
        isAuthenticated: !isDemo,
        isDemo,
        user: isDemo ? null : { id: 'u1' },
        canPersistData: !isDemo,
        session: isDemo ? null : { user: { id: 'u1' } },
        status: isDemo ? 'unauthenticated' : 'authenticated',
    });
    mockUseDemo.mockReturnValue({ ...demoApi, isDemoMode: isDemo });
}

const noNetwork = () => {
    const api = apiClient as unknown as Record<string, jest.Mock>;
    for (const fn of ['get', 'post', 'put', 'delete', 'deleteTransaction']) {
        expect(api[fn]).not.toHaveBeenCalled();
    }
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('demo mode: no write reaches the backend', () => {
    beforeEach(() => setMode(true));

    it('goal create adds to demo state instead of POSTing', async () => {
        const { result } = renderHook(() => useCreateGoal(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync({ title: 'Bike', category: 'other', target_amount: 30000 }));
        noNetwork();
        expect(demoApi.addDemoGoal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bike', targetAmount: 30000 }));
        expect(toastSuccess).toHaveBeenCalledWith(simulated());
    });

    it('goal contribution raises the demo goal instead of POSTing', async () => {
        const { result } = renderHook(() => useAddContribution(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync({ goalId: 'g1', data: { amount: 500 } }));
        noNetwork();
        expect(demoApi.updateDemoGoal).toHaveBeenCalledWith('g1', { currentAmount: 1500 });
    });

    it('goal delete removes the demo goal instead of DELETEing', async () => {
        const { result } = renderHook(() => useDeleteGoal(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync('g1'));
        noNetwork();
        expect(demoApi.removeDemoGoal).toHaveBeenCalledWith('g1');
    });

    it('transaction delete removes the demo row instead of DELETEing', async () => {
        const { result } = renderHook(() => useDeleteTransaction(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync('expense-3'));
        noNetwork();
        expect(demoApi.removeDemoTransaction).toHaveBeenCalledWith('expense-3');
    });

    it('loan add and edit never call the loan service', async () => {
        const create = renderHook(() => useCreateLoan(), { wrapper: createQueryWrapper() });
        await act(() => create.result.current.mutateAsync({ name: 'Car' } as never));
        const update = renderHook(() => useUpdateLoan(), { wrapper: createQueryWrapper() });
        await act(() => update.result.current.mutateAsync({ id: 'demo-loan-1', data: { name: 'X' } as never }));

        expect(loanService.createLoan).not.toHaveBeenCalled();
        expect(loanService.updateLoan).not.toHaveBeenCalled();
        expect(toastSuccess).toHaveBeenCalledWith(simulated());
        expect(toastSuccess).not.toHaveBeenCalledWith('Loan created successfully');
    });
});

describe('authenticated mode still writes', () => {
    beforeEach(() => setMode(false));

    it('goal create POSTs to the trailing-slash path (no 307 redirect)', async () => {
        (apiClient.post as jest.Mock).mockResolvedValue({ data: { id: 'new' } });
        const { result } = renderHook(() => useCreateGoal(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync({ title: 'Bike', category: 'other', target_amount: 30000 }));
        expect(apiClient.post).toHaveBeenCalledWith('/goals/', expect.objectContaining({ title: 'Bike' }));
        expect(demoApi.addDemoGoal).not.toHaveBeenCalled();
    });

    it('transaction delete calls the API', async () => {
        (apiClient.deleteTransaction as jest.Mock).mockResolvedValue({ success: true });
        const { result } = renderHook(() => useDeleteTransaction(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync('t1'));
        expect(apiClient.deleteTransaction).toHaveBeenCalledWith('t1');
        expect(demoApi.removeDemoTransaction).not.toHaveBeenCalled();
    });

    it('loan create calls the loan service', async () => {
        (loanService.createLoan as jest.Mock).mockResolvedValue({ success: true, data: {} });
        const { result } = renderHook(() => useCreateLoan(), { wrapper: createQueryWrapper() });
        await act(() => result.current.mutateAsync({ name: 'Car' } as never));
        expect(loanService.createLoan).toHaveBeenCalled();
    });
});
