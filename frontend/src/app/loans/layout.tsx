import type { ReactNode } from 'react';
import { PremiumGate } from '@/components/access/PremiumGate';

/** A premium page: a free account gets an explanation, and the page never mounts. */
export default function Layout({ children }: { children: ReactNode }) {
  return <PremiumGate>{children}</PremiumGate>;
}
