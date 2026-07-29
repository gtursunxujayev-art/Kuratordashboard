'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { BrandShell } from '@/components/layout/brand-shell';
import { ToastProvider } from '@/components/ui/toast';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('kd-theme') : null;
    const resolved = savedTheme === 'dark' ? 'dark' : 'light';
    setTheme(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('kd-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="kd-subtle">Yuklanmoqda...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <ToastProvider>
      <BrandShell theme={theme} onToggleTheme={toggleTheme}>
        {children}
      </BrandShell>
    </ToastProvider>
  );
}
