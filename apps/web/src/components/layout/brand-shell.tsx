'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

type Theme = 'light' | 'dark';

const baseNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/amaliy', label: 'Amaliy', icon: 'book' },
  { href: '/students', label: "O'quvchilar", icon: 'users' },
  { href: '/telegram', label: 'Telegram', icon: 'send' },
] as const;

const managerNavItems = [
  { href: '/intensiv', label: 'Intensiv', icon: 'calendar' },
  { href: '/hisobot', label: 'Hisobot', icon: 'chart' },
  { href: '/davomat', label: 'Davomat', icon: 'calendar' },
  { href: '/faceid', label: 'Face ID', icon: 'scan' },
  { href: '/settings', label: 'Sozlamalar', icon: 'settings' },
] as const;

function getRoleLabel(roles: string[]): string {
  if (roles.includes('Admin')) return 'Admin';
  if (roles.includes('Bosh Kurator')) return 'Bosh Kurator';
  if (roles.includes('Manager')) return 'Menejer';
  return 'Kurator';
}

function NavIcon({ name }: { name: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'book') {
    return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" /></svg>;
  }
  if (name === 'users') {
    return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
  if (name === 'chart') {
    return <svg {...common}><path d="M3 3v18h18" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-3" /></svg>;
  }
  if (name === 'calendar') {
    return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>;
  }
  if (name === 'send') {
    return <svg {...common}><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></svg>;
  }
  if (name === 'scan') {
    return <svg {...common}><path d="M7 3H5a2 2 0 0 0-2 2v2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" /></svg>;
  }
  if (name === 'settings') {
    return <svg {...common}><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.05V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.05-.4H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.39-.16.73-.42 1-.75.27-.33.4-.73.4-1.15V3a2 2 0 1 1 4 0v.09c0 .42.14.82.4 1.15.27.33.61.59 1 .75a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.16.39.42.73.75 1 .33.27.73.4 1.15.4h.09a2 2 0 1 1 0 4h-.09c-.42 0-.82.14-1.15.4-.33.27-.59.61-.75 1Z" /></svg>;
  }
  return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>;
}

export function BrandShell({
  theme,
  onToggleTheme,
  children,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout, isManager } = useAuth();
  const navItems = isManager ? [...baseNavItems, ...managerNavItems] : baseNavItems;

  return (
    <div className="min-h-screen nn-app-shell">
      <header className="nn-topnav">
        <div className="nn-topnav-inner">
          <Link href="/dashboard" className="nn-brand-lockup" aria-label="Najot Nur dashboard">
            <Image
              src="/brand/najot-nur-official-lockup.png"
              width={200}
              height={62}
              alt="Najot Nur — notiqlik mahorati markazi"
              priority
              className="h-12 w-auto object-contain"
            />
          </Link>

          <nav className="nn-nav-scroll" aria-label="Asosiy navigatsiya">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link key={item.href} href={item.href} className={`nn-nav-link ${active ? 'nn-nav-link-active' : ''}`}>
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="nn-top-actions">
            <button type="button" onClick={onToggleTheme} className="nn-icon-button" title={theme === 'light' ? 'Tungi rejim' : 'Yorug rejim'}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            {user && (
              <div className="nn-user-pill">
                <span className="nn-user-avatar">{(user.name ?? user.username ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</span>
                <span className="hidden xl:block min-w-0">
                  <span className="block truncate text-xs font-semibold text-[var(--kd-text)] max-w-[150px]">{user.name ?? user.username ?? user.email}</span>
                  <span className="block text-[10px] text-[var(--kd-muted)]">{getRoleLabel(user.roles)}</span>
                </span>
              </div>
            )}
            <button type="button" onClick={logout} className="nn-ghost-button hidden sm:inline-flex">
              Chiqish
            </button>
          </div>
        </div>
      </header>
      <main className="nn-main">{children}</main>
    </div>
  );
}
