'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export type UserRole = 'Admin' | 'Manager' | 'Kurator' | 'Bosh Kurator' | 'Agent' | 'Finance' | 'Tashkiliy';

export interface AuthUser {
  userId: string;
  tenantId: string;
  roles: UserRole[];
  username?: string;
  name?: string;
  email?: string;
  phone?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (token: string, userData: AuthUser) => void;
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
  isKurator: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'token';
const USER_KEY = 'auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: false,
    retry: false,
  });

  const refreshUser = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      localStorage.removeItem(USER_KEY);
      setIsLoading(false);
      return;
    }

    try {
      const response = await meQuery.refetch();
      if (response.data) {
        const nextUser: AuthUser = {
          userId: response.data.id,
          tenantId: response.data.tenantId,
          roles: response.data.roles as UserRole[],
          username: response.data.username ?? undefined,
          name: response.data.name ?? undefined,
          email: response.data.email ?? undefined,
          phone: response.data.phone ?? undefined,
        };
        setUser(nextUser);
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      } else {
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    } catch {
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        const cached = localStorage.getItem(USER_KEY);
        if (cached) {
          try {
            setUser(JSON.parse(cached) as AuthUser);
          } catch {
            localStorage.removeItem(USER_KEY);
          }
        }
        await refreshUser();
      } else {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (token: string, userData: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    void refreshUser();
    router.push('/dashboard');
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        isAdmin: user?.roles.includes('Admin') ?? false,
        isManager: user?.roles.some((r) => r === 'Admin' || r === 'Manager' || r === 'Bosh Kurator') ?? false,
        isKurator: user?.roles.some((r) => r === 'Kurator' || r === 'Bosh Kurator') ?? false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
