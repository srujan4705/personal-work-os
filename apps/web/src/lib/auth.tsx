import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { todayIn } from './date';

export interface Me {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

const AuthContext = createContext<{ me: Me | null; loading: boolean; today: string }>({ me: null, loading: true, today: '' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: Me }>('/auth/me').then((r) => r.user), retry: false, staleTime: 5 * 60_000 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    window.addEventListener('pwos:unauthorized', onUnauthorized);
    const t = setInterval(() => setTick((x) => x + 1), 60_000); // keep "today" fresh across midnight
    return () => {
      window.removeEventListener('pwos:unauthorized', onUnauthorized);
      clearInterval(t);
    };
  }, [qc]);
  const me = q.data ?? null;
  void tick;
  return <AuthContext.Provider value={{ me, loading: q.isLoading, today: me ? todayIn(me.timezone) : '' }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
