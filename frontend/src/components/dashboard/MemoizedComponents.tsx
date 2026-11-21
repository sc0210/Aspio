'use client';

import { memo } from 'react';
import { RecentTransactions } from './RecentTransactions';

// Memoized RecentTransactions — it takes no props, so it re-renders only on its own data
export const MemoizedRecentTransactions = memo(RecentTransactions);
MemoizedRecentTransactions.displayName = 'MemoizedRecentTransactions';
