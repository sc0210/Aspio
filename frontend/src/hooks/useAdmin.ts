import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/contexts/AuthContext';
// Check if user has admin privileges
export function useIsAdmin() {
  const { status } = useAuthContext();

  // Query to check if user is admin
  const { data: adminStatus } = useQuery({
    queryKey: ['admin', 'check-status'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/check');

        if (response.status === 403 || response.status === 401) {
          return { isAdmin: false, isSuperAdmin: false, role: null };
        }
        if (!response.ok) {
          return { isAdmin: false, isSuperAdmin: false, role: null };
        }
        const data = await response.json();
        return data;
      } catch {
        return { isAdmin: false, isSuperAdmin: false, role: null };
      }
    },
    enabled: status === 'authenticated',
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    isAdmin: adminStatus?.isAdmin || false,
    isSuperAdmin: adminStatus?.isSuperAdmin || false,
    role: adminStatus?.role || null
  };
}