'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

/** Error boundary UI for the /achievements route segment. */
export default function AchievementsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback {...props} segment="achievements" />;
}
