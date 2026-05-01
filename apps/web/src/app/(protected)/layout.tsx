'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Sidebar } from '@/components/layout/sidebar';
import { ToastProvider } from '@/components/ui/toast';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = isDrawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
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
      <div className="min-h-screen relative kd-main">
        <button
          type="button"
          onClick={() => setIsDrawerOpen((prev) => !prev)}
          aria-label={isDrawerOpen ? 'Menyuni yopish' : 'Menyuni ochish'}
          aria-expanded={isDrawerOpen}
          className="fixed top-3 left-3 z-[70] w-10 h-10 flex items-center justify-center rounded-md text-white"
          style={{ background: 'var(--kd-sidebar-bg)', border: '1px solid rgba(255,255,255,0.45)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>

        {isDrawerOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setIsDrawerOpen(false)}
              aria-hidden
            />
            <div className="fixed inset-y-0 left-0 z-50 w-64 shadow-xl">
              <Sidebar
                theme={theme}
                onToggleTheme={toggleTheme}
                onNavigate={() => setIsDrawerOpen(false)}
              />
            </div>
          </>
        )}

        <div
          className={`min-h-screen transition-[padding-left] duration-200 ease-out ${
            isDrawerOpen ? 'md:pl-64' : 'md:pl-0'
          }`}
        >
          <main className="overflow-auto kd-main pt-16">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
