'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Sidebar } from '@/components/layout/sidebar';
import { ToastProvider } from '@/components/ui/toast';

const SECTION_TITLES: Record<string, string> = {
  '/dashboard': 'Bosh sahifa',
  '/ofline': 'Ofline',
  '/online': 'Online',
  '/intensiv': 'Intensiv',
  '/students': "O'quvchilar",
  '/amaliy': 'Amaliy',
  '/settings': 'Sozlamalar',
};

function getSectionTitle(pathname: string): string {
  for (const prefix of Object.keys(SECTION_TITLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return SECTION_TITLES[prefix];
  }
  return 'Kurator Panel';
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
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
      <div className="min-h-screen md:flex">
        {/* Mobile top bar */}
        <header
          className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 h-14"
          style={{ backgroundColor: 'var(--kd-sidebar-bg)', color: '#fff' }}
        >
          <button
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Menu"
            className="w-10 h-10 flex items-center justify-center rounded-md"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.35)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold truncate mx-2">{getSectionTitle(pathname)}</h1>
          <button
            onClick={toggleTheme}
            aria-label="Theme"
            className="w-10 h-10 flex items-center justify-center rounded-md text-xs"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.35)' }}
          >
            {theme === 'light' ? '🌙' : '☀'}
          </button>
        </header>

        {/* Desktop: static sidebar */}
        <div className="hidden md:block">
          <Sidebar theme={theme} onToggleTheme={toggleTheme} />
        </div>

        {/* Mobile: drawer */}
        {isDrawerOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-40 bg-black/50"
              onClick={() => setIsDrawerOpen(false)}
              aria-hidden
            />
            <div className="md:hidden fixed inset-y-0 left-0 z-50 w-64 shadow-xl">
              <Sidebar
                theme={theme}
                onToggleTheme={toggleTheme}
                onNavigate={() => setIsDrawerOpen(false)}
              />
            </div>
          </>
        )}

        <main className="flex-1 overflow-auto kd-main">{children}</main>
      </div>
    </ToastProvider>
  );
}
