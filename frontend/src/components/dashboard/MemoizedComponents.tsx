'use client';

import { memo } from 'react';
import { RecentTransactions } from './RecentTransactions';

// Memoized RecentTransactions — shallow prop comparison is sufficient since dateRange is the only prop
export const MemoizedRecentTransactions = memo(RecentTransactions);
MemoizedRecentTransactions.displayName = 'MemoizedRecentTransactions';
