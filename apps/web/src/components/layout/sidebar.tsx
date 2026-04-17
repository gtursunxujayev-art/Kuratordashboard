'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const navItems = [
  { href: '/dashboard', label: 'Bosh sahifa', icon: 'DB' },
  { href: '/ofline', label: 'Ofline', icon: 'OF' },
  { href: '/online', label: 'Online', icon: 'ON' },
  { href: '/intensiv', label: 'Intensiv', icon: 'IN' },
  { href: '/students', label: "O'quvchilar", icon: 'ST' },
  { href: '/amaliy', label: 'Amaliy', icon: 'AM' },
] as const;

const adminNavItems = [{ href: '/settings', label: 'Sozlamalar', icon: 'SZ' }] as const;

export function Sidebar({
  theme,
  onToggleTheme,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();

  return (
    <aside
      className="w-64 min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--kd-sidebar-bg)', borderRight: '1px solid rgba(255, 255, 255, 0.45)' }}
    >
      <div className="p-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.35)' }}>
        <h1 className="text-lg font-bold kd-title">Kurator Panel</h1>
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

      <nav className="flex-1 py-4 px-2" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.22)' }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold rounded-md transition-colors mb-1"
              style={
                isActive
                  ? {
                      background: 'rgba(255, 255, 255, 0.14)',
                      color: '#ffffff',
                      border: '1px solid rgba(255, 255, 255, 0.55)',
                    }
                  : {
                      color: 'rgba(255, 255, 255, 0.94)',
                      border: '1px solid rgba(255, 255, 255, 0.24)',
                    }
              }
            >
              <span className="text-[10px] font-semibold opacity-95">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {isAdmin &&
          adminNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold rounded-md transition-colors mb-1"
                style={
                  isActive
                    ? {
                        background: 'rgba(255, 255, 255, 0.14)',
                        color: '#ffffff',
                        border: '1px solid rgba(255, 255, 255, 0.55)',
                      }
                    : {
                        color: 'rgba(255, 255, 255, 0.94)',
                        border: '1px solid rgba(255, 255, 255, 0.24)',
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
        <button onClick={logout} className="w-full text-sm text-left transition-colors" style={{ color: '#ffffff' }}>
          Chiqish
        </button>
      </div>
    </aside>
  );
}
