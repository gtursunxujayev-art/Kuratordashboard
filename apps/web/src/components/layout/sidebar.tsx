'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const dashboardChildren = [
  { href: '/ofline', label: 'Ofline', icon: 'OF' },
  { href: '/online', label: 'Online', icon: 'ON' },
  { href: '/intensiv', label: 'Intensiv', icon: 'IN' },
] as const;

const navItems = [
  { href: '/students', label: "O'quvchilar", icon: 'ST' },
  { href: '/amaliy', label: 'Amaliy', icon: 'AM' },
] as const;

const managerNavItems = [
  { href: '/davomat', label: 'Davomat', icon: 'DV' },
  { href: '/hisobot', label: 'Hisobot', icon: 'HS' },
  { href: '/settings', label: 'Sozlamalar', icon: 'SZ' },
];

export function Sidebar({
  theme,
  onToggleTheme,
  onNavigate,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { user, logout, isManager } = useAuth();
  const isDashboardChildActive = useMemo(
    () => dashboardChildren.some((child) => pathname === child.href || pathname.startsWith(child.href + '/')),
    [pathname],
  );
  const isDashboardActive = pathname === '/dashboard' || pathname.startsWith('/dashboard/') || isDashboardChildActive;
  const [isDashboardOpen, setIsDashboardOpen] = useState(isDashboardChildActive);

  useEffect(() => {
    setIsDashboardOpen(isDashboardChildActive);
  }, [isDashboardChildActive]);

  return (
    <aside
      className="w-64 h-full max-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--kd-sidebar-bg)', borderRight: '1px solid rgba(255, 255, 255, 0.45)' }}
    >
      <div className="p-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.35)' }}>
        <h1 className="text-lg font-bold" style={{ color: '#ffffff' }}>
          Kurator Panel
        </h1>
        {user && (
          <p className="text-xs mt-1 truncate" style={{ color: 'rgba(255, 255, 255, 0.92)' }}>
            {user.name ?? user.username ?? user.email}
          </p>
        )}
        {user && (
          <span
            className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(255, 255, 255, 0.14)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              color: '#ffffff',
            }}
          >
            {user.roles.includes('Admin') ? 'Admin' : user.roles.includes('Manager') ? 'Menejer' : 'Kurator'}
          </span>
        )}

        <button
          onClick={onToggleTheme}
          className="mt-3 w-full text-left text-xs px-3 py-2 rounded-md transition-colors"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.45)',
            background: 'rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
          }}
        >
          {theme === 'light' ? 'Tungi rejim' : 'Yorug rejim'}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.22)' }}>
        <div
          className="mb-1 rounded-md"
          style={
            isDashboardActive
              ? {
                  background: 'rgba(255, 255, 255, 0.20)',
                  border: '2px solid rgba(255, 255, 255, 0.78)',
                }
              : {
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.38)',
                }
          }
        >
          <div className="flex items-center">
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className="flex-1 flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-l-md transition-colors"
              style={{ color: '#ffffff' }}
            >
              <span className="text-[10px] font-semibold opacity-95">DB</span>
              Bosh sahifa
            </Link>
            <button
              type="button"
              onClick={() => setIsDashboardOpen((prev) => !prev)}
              aria-label={isDashboardOpen ? "Bosh sahifa bo'limini yopish" : "Bosh sahifa bo'limini ochish"}
              aria-expanded={isDashboardOpen}
              className="px-3 py-3 rounded-r-md transition-colors"
              style={{ color: '#ffffff' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isDashboardOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 160ms ease',
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          {isDashboardOpen && (
            <div className="px-2 pb-2">
              {dashboardChildren.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className="flex items-center gap-3 ml-6 pl-3 pr-3 py-2 text-xs font-semibold rounded-md transition-colors mb-1"
                    style={
                      isActive
                        ? {
                            background: 'rgba(255, 255, 255, 0.20)',
                            color: '#ffffff',
                            border: '1px solid rgba(255, 255, 255, 0.60)',
                          }
                        : {
                            color: '#ffffff',
                            background: 'rgba(255, 255, 255, 0.10)',
                            border: '1px solid rgba(255, 255, 255, 0.28)',
                          }
                    }
                  >
                    <span className="text-[10px] font-semibold opacity-95">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-md transition-colors mb-1"
              style={
                isActive
                  ? {
                      background: 'rgba(255, 255, 255, 0.20)',
                      color: '#ffffff',
                      border: '2px solid rgba(255, 255, 255, 0.78)',
                    }
                  : {
                      color: '#ffffff',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.38)',
                    }
              }
            >
              <span className="text-[10px] font-semibold opacity-95">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {isManager &&
          managerNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-md transition-colors mb-1"
                style={
                  isActive
                    ? {
                        background: 'rgba(255, 255, 255, 0.20)',
                        color: '#ffffff',
                        border: '2px solid rgba(255, 255, 255, 0.78)',
                      }
                    : {
                        color: '#ffffff',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.38)',
                      }
                }
              >
                <span className="text-[10px] font-semibold opacity-95">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

      </nav>

      <div className="p-4" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.35)' }}>
        <button
          onClick={() => {
            onNavigate?.();
            logout();
          }}
          className="w-full text-sm text-left px-3 py-2 rounded-md transition-colors"
          style={{
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.45)',
            background: 'rgba(255, 255, 255, 0.10)',
          }}
        >
          Chiqish
        </button>
      </div>
    </aside>
  );
}
