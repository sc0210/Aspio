'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { PlusIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TOP_BAR_BUTTON, TOP_BAR_PRIMARY } from '@/components/layout/topBarStyles';
import { DemoLocked } from '@/components/ui/DemoLocked';
import { apiClient } from '@/lib/api-client';
import AddPeerModal from '@/components/compare/AddPeerModal';
import PendingInviteBanner from '@/components/compare/PendingInviteBanner';
import CompareStatCards from '@/components/compare/CompareStatCards';
import { PeerRoster } from '@/components/savings/PeerRoster';
import SharedGoalCard from '@/components/savings/SharedGoalCard';
import CreateGoalModal from '@/components/savings/CreateGoalModal';
import SavingRecordsModal from '@/components/savings/SavingRecordsModal';
import { withRecordTotals } from '@/components/savings/recordOwnership';
import { demoCompareData, demoPeerConnections, demoSavingRecords, demoSharedGoals } from '@/data/demoData';
import type { CompareDataResponse, PeerConnectionOut, SharedGoalOut } from '@/shared/types';
import { formatCurrency as formatCurrencyUtil } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { useIsMobile } from '@/hooks/useMediaQuery';

// CompareLineChart imports recharts (~386 kB) — loaded only once the Compare
// tab is opened, so a visit for goals never pays for it.
const CompareLineChart = dynamic(() => import('@/components/compare/CompareLineChart'), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-80" />
  ),
});

const formatTWD = (value: number) => formatCurrencyUtil(value, 'TWD', { precision: 0 });

type Tab = 'goals' | 'compare';
const TABS: Tab[] = ['goals', 'compare'];

/**
 * Saving with other people: the goals you share, and how your finances compare.
 *
 * This was two pages — /savings under Finance and /compare under Analysis —
 * that each fetched, listed and let you remove the same peer connections, and
 * each rendered shared goals with an implementation of its own. The roster now
 * appears once and the two views are tabs beneath it. /compare redirects to the
 * Compare tab (next.config.js), which is why the tab lives in the URL: that
 * redirect, a bookmark and the back button all land on the right one.
 */
export default function SavingsPage() {
  // useSearchParams must sit under a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<PageSpinner />}>
      <SavingsGroups />
    </Suspense>
  );
}

function SavingsGroups() {
  const { isAuthenticated, isDemo, status, user } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  // Compare values arrive in TWD, so they are labelled TWD. Formatting them with
  // the viewer's preferred currency changed only the symbol, not the number: a
  // NT$7,099,345 portfolio read as "$7,099,345" for a USD-preferring viewer.
  const compareCurrency = 'TWD';

  // Who "you" are when a saving record is attributed; see isOwnRecord.
  const currentUserId = user?.id ?? '';

  const tab: Tab = searchParams.get('tab') === 'compare' ? 'compare' : 'goals';

  const [connections, setConnections] = useState<PeerConnectionOut[]>([]);
  const [goals, setGoals] = useState<SharedGoalOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddPeerOpen, setIsAddPeerOpen] = useState(false);
  const [isCreateGoalOpen, setIsCreateGoalOpen] = useState(false);
  const [recordsGoal, setRecordsGoal] = useState<SharedGoalOut | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);

  // The comparison is fetched the first time its tab is shown, and again after
  // the roster changes — not with the page, since most visits are for goals.
  const [compareData, setCompareData] = useState<CompareDataResponse | null>(null);
  const [compareStale, setCompareStale] = useState(true);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const selectTab = (next: Tab) => {
    // Rewrite only `tab`; any other query parameter rides along.
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'goals') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // A comparison that failed to load gets another attempt when its tab is chosen again.
    if (next === 'compare' && compareError) setCompareStale(true);
  };

  const isLoading = status === 'loading';
  const hasAccess = isAuthenticated || isDemo;

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      router.replace('/auth/signin');
    }
  }, [isLoading, hasAccess, router]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [connectionsRes, goalsRes] = await Promise.all([
        apiClient.getPeerConnections(),
        apiClient.listSharedGoals(),
      ]);
      setConnections(connectionsRes.data ?? []);
      setGoals(goalsRes.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.loadFailed', 'Failed to load savings goals'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Anything that changes who is on the roster changes the comparison too.
  const refresh = useCallback(async () => {
    setCompareStale(true);
    await fetchData();
  }, [fetchData]);

  // Only the latest request may write: an older response arriving late must not
  // put back a peer the roster has since dropped.
  const compareRequest = useRef(0);
  const loadCompare = useCallback(async () => {
    const request = ++compareRequest.current;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await apiClient.getPeerCompareData();
      if (request !== compareRequest.current) return;
      // A successful response with no payload is an empty comparison, not a
      // load that never finishes.
      setCompareData(res.data ?? { users: [], chart: [] });
    } catch (err) {
      if (request !== compareRequest.current) return;
      setCompareError(err instanceof Error ? err.message : t('compare.errors.loadFailed', 'Failed to load compare data'));
    } finally {
      if (request === compareRequest.current) setCompareLoading(false);
    }
  }, [t]);

  // Goals alone, without the page-level loading state: a saving record or a new
  // goal changes the goals list, not the roster, and should not blank the page
  // behind the modal that made the change.
  const refreshGoals = useCallback(async () => {
    try {
      const res = await apiClient.listSharedGoals();
      setGoals(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.loadFailed', 'Failed to load savings goals'));
    }
  }, [t]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    } else if (isDemo) {
      // Demo mode: fixtures for every view, no backend call. Goal totals come
      // from the saving-record fixture, which the records modal edits in memory;
      // reading the static goal amounts instead undid a demo deposit on the card
      // every time the page remounted, while the records list kept it.
      setConnections(demoPeerConnections);
      setGoals(
        demoSharedGoals.map((g) => {
          const records = demoSavingRecords[g.id];
          return records ? withRecordTotals(g, records, currentUserId) : g;
        }),
      );
      setCompareData(demoCompareData);
      setCompareStale(false);
      setLoading(false);
    }
  }, [isAuthenticated, isDemo, fetchData, currentUserId]);

  useEffect(() => {
    // Only where the compare tab is shown — phones never show it (#344).
    if (tab === 'compare' && isMobile === false && isAuthenticated && compareStale) {
      setCompareStale(false);
      loadCompare();
    }
  }, [tab, isMobile, isAuthenticated, compareStale, loadCompare]);

  const handleRemovePeer = async (id: string) => {
    if (isDemo) {
      const peerUserId = connections.find((c) => c.id === id)?.other_user.id;
      setConnections((prev) => prev.filter((c) => c.id !== id));
      if (peerUserId) {
        // Drop their chart line and stat card too, or the comparison keeps
        // someone the roster no longer shows.
        setCompareData((prev) =>
          prev
            ? {
                users: prev.users.filter((u) => u.user_id !== peerUserId),
                chart: prev.chart.map((row) => {
                  const next = { ...row };
                  delete next[peerUserId];
                  return next;
                }),
              }
            : prev,
        );
      }
      return;
    }
    setRemovingId(id);
    try {
      await apiClient.removePeerConnection(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.removeFailed', 'Failed to remove peer'));
    } finally {
      setRemovingId(null);
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (isDemo) {
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
      return;
    }
    setDeletingGoalId(goalId);
    try {
      await apiClient.deleteSharedGoal(goalId);
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.errors.deleteFailed', 'Failed to delete goal'));
    } finally {
      setDeletingGoalId(null);
    }
  };

  // A goal's totals are the sum of its saving records, which the backend
  // recomputes on every change. Demo mode has no backend, so recompute here from
  // the fixture the records modal just wrote — otherwise a new deposit appears in
  // the records list and nowhere on the card.
  const handleRecordChanged = useCallback(
    (goalId: string) => {
      if (!isDemo) {
        refreshGoals();
        return;
      }
      const records = demoSavingRecords[goalId] ?? [];
      setGoals((prev) => prev.map((g) => (g.id === goalId ? withRecordTotals(g, records, currentUserId) : g)));
    },
    [isDemo, refreshGoals, currentUserId],
  );

  if (isLoading) {
    return <PageSpinner />;
  }

  const receivedPending = connections.filter(
    (c) => c.direction === 'received' && c.status === 'pending',
  );
  const sentPending = connections.filter(
    (c) => c.direction === 'sent' && c.status === 'pending',
  );
  const accepted = connections.filter((c) => c.status === 'accepted');
  const hasPeers = accepted.length > 0;
  // Phones (#344): the goals view only, combined progress first and the roster
  // after it — the compare chart and its stat cards stay on bigger screens.
  const phone = isMobile === true;
  const activeTab: Tab = phone ? 'goals' : tab;
  const canCreateGoal = hasPeers && activeTab === 'goals';
  const roster = (
    <PeerRoster
      accepted={accepted}
      sentPending={sentPending}
      removingId={removingId}
      onRemove={handleRemovePeer}
    />
  );

  return (
    <DashboardLayout topBarActions={
      !isDemo ? (
        <>
          {canCreateGoal && (
            <button onClick={() => setIsCreateGoalOpen(true)} className={TOP_BAR_PRIMARY}>
              <PlusIcon className="w-4 h-4" />
              {t('savings.createGoal', 'New Goal')}
            </button>
          )}
          <button onClick={() => setIsAddPeerOpen(true)} className={TOP_BAR_BUTTON}>
            <PlusIcon className="w-4 h-4" />
            {t('savings.addPeer', 'Add Member')}
          </button>
        </>
      ) : undefined
    }>
      <div className="space-y-6">
        {/* Mobile header — desktop title is in top bar */}
        <div className="md:hidden flex items-center justify-between">
          <h1 className="text-base font-bold text-gray-900 dark:text-white">
            {t('savings.title', 'Savings Groups')}
          </h1>
          <div className="flex gap-2">
            {canCreateGoal && (
              <DemoLocked>
                <button onClick={() => setIsCreateGoalOpen(true)} className={TOP_BAR_PRIMARY}>
                  <PlusIcon className="w-4 h-4" />
                  {t('savings.createGoal', 'New Goal')}
                </button>
              </DemoLocked>
            )}
            <DemoLocked>
              <button onClick={() => setIsAddPeerOpen(true)} className={TOP_BAR_BUTTON}>
                <PlusIcon className="w-4 h-4" />
                {t('savings.addPeer', 'Add Member')}
              </button>
            </DemoLocked>
          </div>
        </div>

        {isDemo && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
            <span aria-hidden="true">👁️</span> {t('savings.demoBanner', 'Demo mode: showing sample data. Sign in to invite real partners and create goals.')}
          </div>
        )}

        {error && (
          <div role="alert" className="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 p-4 rounded-lg text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Pending invites (real mode only) */}
            {!isDemo && receivedPending.length > 0 && (
              <PendingInviteBanner invites={receivedPending} onRespond={refresh} />
            )}

            {!phone && roster}

            {/* No accepted peers yet — neither view has anything to show. Shown
                while invites are still pending, as /compare did, and in demo
                after every sample peer is removed; otherwise the page is a
                roster and nothing else. */}
            {!hasPeers && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm flex flex-col items-center text-center gap-4">
                <UsersIcon className="w-14 h-14 text-gray-300 dark:text-gray-600" />
                <div>
                  <p className="text-gray-700 dark:text-gray-300 font-medium">
                    {t('savings.emptyPeersTitle', 'Invite a peer to get started.')}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    {t('savings.emptyPeersSubtext', 'Add a peer to start creating shared savings goals together.')}
                  </p>
                </div>
                <DemoLocked>
                  <button
                    onClick={() => setIsAddPeerOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 transition-colors"
                  >
                    <PlusIcon className="w-4 h-4" />
                    {t('savings.addPeer', 'Add Member')}
                  </button>
                </DemoLocked>
              </div>
            )}

            {hasPeers && (
              <>
                {!phone && <TabBar tab={tab} onSelect={selectTab} />}

                <div
                  role={phone ? undefined : 'tabpanel'}
                  id={phone ? undefined : `savings-panel-${tab}`}
                  aria-labelledby={phone ? undefined : `savings-tab-${tab}`}
                >
                  {activeTab === 'goals' ? (
                    <div className="space-y-6">
                      {goals.length > 0 && <CombinedProgress goals={goals} />}

                      {goals.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 shadow-sm flex flex-col items-center text-center gap-4">
                          <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                            <span className="text-2xl" aria-hidden="true">🎯</span>
                          </div>
                          <div>
                            <p className="text-gray-700 dark:text-gray-300 font-medium">
                              {t('savings.emptyGoalsTitle', 'Create your first savings goal.')}
                            </p>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                              {t('savings.emptyGoalsSubtext', 'Set a target and track your combined progress toward a shared goal.')}
                            </p>
                          </div>
                          {!isDemo && (
                            <button
                              onClick={() => setIsCreateGoalOpen(true)}
                              className="flex items-center gap-2 px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 transition-colors"
                            >
                              <PlusIcon className="w-4 h-4" />
                              {t('savings.createGoal', 'New Goal')}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {goals.map((goal) => (
                            <SharedGoalCard
                              key={goal.id}
                              goal={goal}
                              onViewRecords={setRecordsGoal}
                              onDelete={handleDeleteGoal}
                              deleting={deletingGoalId === goal.id}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : compareError ? (
                    <div role="alert" className="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 p-4 rounded-lg text-sm">
                      {compareError}
                    </div>
                  ) : compareLoading || !compareData ? (
                    <div aria-hidden="true" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm animate-pulse h-80" />
                  ) : (
                    <div className="space-y-6">
                      <CompareLineChart chart={compareData.chart} users={compareData.users} currency={compareCurrency} />
                      <CompareStatCards users={compareData.users} currency={compareCurrency} />
                    </div>
                  )}
                </div>
              </>
            )}

            {phone && roster}
          </>
        )}
      </div>

      {/* Modals — only shown in real (non-demo) mode, except saving records, which works on local fixtures */}
      {!isDemo && (
        <>
          <AddPeerModal
            isOpen={isAddPeerOpen}
            onClose={() => setIsAddPeerOpen(false)}
            onSuccess={refresh}
          />
          <CreateGoalModal
            isOpen={isCreateGoalOpen}
            onClose={() => setIsCreateGoalOpen(false)}
            onSuccess={refreshGoals}
            connections={accepted}
          />
        </>
      )}

      <SavingRecordsModal
        goal={recordsGoal}
        isDemo={isDemo}
        currentUserId={currentUserId}
        onClose={() => setRecordsGoal(null)}
        onRecordChanged={handleRecordChanged}
      />
    </DashboardLayout>
  );
}

function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (tab: Tab) => void }) {
  const { t } = useTranslation('common');

  return (
    <div
      role="tablist"
      aria-label={t('savings.tabs.label', 'Savings group views')}
      className="inline-flex p-1 rounded-lg bg-gray-100 dark:bg-gray-800"
    >
      {TABS.map((id) => {
        const selected = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`savings-tab-${id}`}
            aria-selected={selected}
            aria-controls={`savings-panel-${id}`}
            // Roving tabindex: Tab reaches the selected tab, arrows move between them.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const step = e.key === 'ArrowRight' ? 1 : -1;
              const next = TABS[(TABS.indexOf(id) + step + TABS.length) % TABS.length];
              onSelect(next);
              document.getElementById(`savings-tab-${next}`)?.focus();
            }}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
              selected
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            )}
          >
            {t(`savings.tabs.${id}`)}
          </button>
        );
      })}
    </div>
  );
}

function CombinedProgress({ goals }: { goals: SharedGoalOut[] }) {
  const { t } = useTranslation('common');
  const totalSaved = goals.reduce((s, g) => s + g.total_amount, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0);
  const overallPct = totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;
  const completedCount = goals.filter((g) => g.status === 'completed').length;
  const activeCount = goals.length - completedCount;

  return (
    <div className="bg-gradient-to-r from-primary-50 via-blue-50 to-prosperity-50/40 dark:from-primary-900/20 dark:via-blue-900/10 dark:to-prosperity-900/10 rounded-xl p-5 border border-primary-100/70 dark:border-primary-800/40">
      <p className="text-xs font-semibold text-primary-700 dark:text-primary-400 uppercase tracking-wide mb-3">
        {t('savings.summary.title', 'Combined savings progress')}
      </p>
      <div className="flex items-end gap-2 mb-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{formatTWD(totalSaved)}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">
          {t('savings.summary.savedOf', 'saved of {{target}}', { target: formatTWD(totalTarget) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(overallPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('savings.summary.aria', 'Combined savings progress: {{pct}}%', { pct: overallPct.toFixed(1) })}
        className="h-2 bg-white/70 dark:bg-gray-700/60 rounded-full mb-3 overflow-hidden"
      >
        <div
          aria-hidden="true"
          style={{ width: `${overallPct}%` }}
          className="h-full rounded-full bg-primary-500 transition-all duration-700"
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="font-semibold text-gray-900 dark:text-white">{overallPct.toFixed(1)}%</span>
          <span className="text-gray-500 dark:text-gray-400 ml-1">{t('savings.summary.overall', 'overall')}</span>
        </div>
        <div>
          <span className="font-semibold text-gray-900 dark:text-white">{activeCount}</span>
          <span className="text-gray-500 dark:text-gray-400 ml-1">{t('savings.summary.active', 'active')}</span>
        </div>
        {completedCount > 0 && (
          <div>
            <span className="font-semibold text-prosperity-700 dark:text-prosperity-400">
              <span aria-hidden="true">🎉 </span>{completedCount}
            </span>
            <span className="text-gray-500 dark:text-gray-400 ml-1">{t('savings.summary.completed', 'completed')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PageSpinner() {
  return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    </DashboardLayout>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm animate-pulse">
        <div className="flex gap-5">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4" />
            <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full mb-3" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
