'use client';

import { LineBotGate } from '@/components/line/LineBotGate';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  UserGroupIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleIconSolid } from '@heroicons/react/24/solid';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/utils/formatters';
import { useAppMode } from '@/hooks/useAppMode';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileGroups } from '@/components/groups/MobileGroups';
import {
  demoLineLinkStatus,
  demoGroups,
  demoGroupBalances,
  DEMO_GROUP_SELF_ID,
} from '@/data/demoData';

type LinkStatus = { linked: boolean; display_name?: string };

type Group = {
  id: string;
  line_group_id: string;
  name: string | null;
  currency: string;
  member_count: number;
  created_at: string;
};

type BalanceEntry = {
  owed_by: string;
  owed_to: string;
  amount: string;
  currency: string;
};

type GroupBalances = {
  group_id: string;
  currency: string;
  balances: BalanceEntry[];
  member_names: Record<string, string>;
};

function fmt(amount: string | number, currency = 'TWD') {
  return formatCurrency(Number(amount), currency, { precision: 0 });
}

function short(uuid: string) {
  return uuid.slice(0, 8);
}

function GroupCard({ group, isDemo, selfId }: { group: Group; isDemo: boolean; selfId: string }) {
  const { t } = useTranslation('groups');
  const [expanded, setExpanded] = useState(false);
  const [balances, setBalances] = useState<GroupBalances | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!expanded && !balances) {
      // Demo mode: serve fixtures, never hit the backend.
      if (isDemo) {
        setBalances(
          demoGroupBalances[group.id] ?? {
            group_id: group.id,
            currency: group.currency,
            balances: [],
            member_names: {},
          },
        );
        setExpanded(true);
        return;
      }
      setLoading(true);
      try {
        const res = await apiClient.get<GroupBalances>(`/line-bot/groups/${group.id}/balances`);
        setBalances(res.data ?? null);
      } catch {
        setBalances({ group_id: group.id, currency: group.currency, balances: [], member_names: {} });
      } finally {
        setLoading(false);
      }
    }
    setExpanded(v => !v);
  };

  const hasBalance = balances && balances.balances.length > 0;

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in">
      <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
        <Link href={`/groups/${group.id}`} className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
            <UserGroupIcon className="w-5 h-5 text-green-700 dark:text-green-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white truncate">
              {group.name || 'LINE Group'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('members', { count: group.member_count })} · {group.currency}
            </p>
          </div>
        </Link>
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0"
        >
          {loading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              <span>{t('balances')}</span>
              {expanded ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
            </>
          )}
        </button>
      </div>

      {expanded && balances && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 sm:px-5 py-4">
          {!hasBalance ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-green-700 dark:text-green-400">
              <CheckCircleIconSolid className="w-4 h-4" />
              <span className="font-medium">{t('allSettledUp')}</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {balances.balances.map((b) => {
                const name = (id: string) => balances.member_names[id] ?? short(id);
                // Your own edges read from your side, coloured by direction;
                // everyone else's stay neutral third-person.
                const youOwe = !!selfId && b.owed_by === selfId;
                const owedToYou = !!selfId && b.owed_to === selfId;
                return (
                  <div key={`${b.owed_by}-${b.owed_to}`} className="flex items-center justify-between text-sm gap-3">
                    <span className="text-gray-600 dark:text-gray-300 min-w-0 truncate">
                      {youOwe ? (
                        <span className="font-medium text-gray-900 dark:text-white">{t('mobile.youOweName', { name: name(b.owed_to) })}</span>
                      ) : owedToYou ? (
                        <span className="font-medium text-gray-900 dark:text-white">{t('mobile.owesYou', { name: name(b.owed_by) })}</span>
                      ) : (
                        <>
                          <span className="font-medium text-gray-900 dark:text-white">{name(b.owed_by)}</span>
                          <span className="text-gray-500 dark:text-gray-500 mx-1.5">{t('owes')}</span>
                          <span className="font-medium text-gray-900 dark:text-white">{name(b.owed_to)}</span>
                        </>
                      )}
                    </span>
                    <span className={`font-semibold shrink-0 ${
                      owedToYou ? 'text-green-700 dark:text-green-400'
                        : youOwe ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      {fmt(b.amount, b.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DesktopGroupsPage() {
  const { t } = useTranslation(['common', 'groups']);
  const { isDemo, user } = useAppMode();
  // Group members are keyed by Aspiro user id, so "you" is the session's id.
  const selfId = isDemo ? DEMO_GROUP_SELF_ID : (user?.id ?? '');
  const [linkStatus, setLinkStatus] = useState<LinkStatus | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Demo mode: render from fixtures, never call the backend.
    if (isDemo) {
      setLinkStatus(demoLineLinkStatus);
      setGroups(demoGroups);
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const statusRes = await apiClient.get<LinkStatus>('/line-bot/link-status');
        const status = statusRes.data ?? null;
        setLinkStatus(status);
        if (status?.linked) {
          const groupsRes = await apiClient.get<Group[]>('/line-bot/groups');
          setGroups(groupsRes.data ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isDemo]);

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header — mobile only */}
        <PageHeader
            title={t('groups:title')}
            subtitle={t('groups:subtitle')}
            accent="green"
            actions={
                linkStatus?.linked ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 font-medium">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span>
                            {linkStatus.display_name
                                ? t('groups:connectedAs', { name: linkStatus.display_name })
                                : t('groups:connected')}
                        </span>
                    </div>
                ) : undefined
            }
        />

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : !linkStatus?.linked ? (
          /* Not linked — connect prompt */
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in">
            <div className="px-6 py-12 text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="#06C755">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </div>
              <p className="font-semibold text-gray-900 dark:text-white mb-1">
                {t('groups:notLinked.title')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs mx-auto">
                {t('groups:notLinked.description')}
              </p>
              <Button asChild>
                <Link href="/link-line">
                  {t('groups:notLinked.button')}
                </Link>
              </Button>
            </div>
          </div>
        ) : groups.length === 0 ? (
          /* Linked but no groups */
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fade-in">
            <div className="px-6 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
                <UserGroupIcon className="w-6 h-6 text-gray-500 dark:text-gray-400" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-white mb-1">
                {t('groups:noGroups.title')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                {t('groups:noGroups.description', { command: '/link' })}
              </p>
            </div>
          </div>
        ) : (
          /* Group list */
          <div className="space-y-3">
            {groups.map(g => <GroupCard key={g.id} group={g} isDemo={isDemo} selfId={selfId} />)}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

/**
 * Breakpoint switch (#344): phones get MobileGroups — your net across every group,
 * then each group with your share of it; tablet/desktop get the expandable cards.
 */
export default function GroupsPage() {
  return <LineBotGate><GroupsPageContent /></LineBotGate>;
}

function GroupsPageContent() {
  const isMobile = useIsMobile();
  if (isMobile === null) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      </DashboardLayout>
    );
  }
  return isMobile ? <MobileGroups /> : <DesktopGroupsPage />;
}
