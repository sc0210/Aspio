'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LandingPage } from '@/components/landing/LandingPage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAppMode } from '@/hooks/useAppMode';

export default function HomePage() {
  const { isAuthenticated, isDemo, isLoading } = useAppMode();
  const router = useRouter();

  useEffect(() => {
    // Redirect authenticated users to dashboard
    if ((isAuthenticated || isDemo) && !isLoading) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, isDemo, isLoading, router]);

  if (isLoading && !isDemo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isAuthenticated || isDemo) {
    return null; // Will redirect via useEffect
  }

  return <LandingPage />;
}