'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const navItems = [
  { href: '/dashboard', label: 'Bosh sahifa', icon: '📊' },
  { href: '/students', label: "O'quvchilar", icon: '👥' },
  { href: '/amaliy', label: 'Amaliy', icon: '📝' },
] as const;

const adminNavItems = [
  { href: '/settings', label: 'Sozlamalar', icon: '⚙️' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Kurator Panel</h1>
        {user && (
          <p className="text-xs text-gray-500 mt-1 truncate">
            {user.name ?? user.username ?? user.email}
          </p>
        )}
        {user && (
          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {user.roles.includes('Admin')
              ? 'Admin'
              : user.roles.includes('Manager')
              ? 'Menejer'
              : 'Kurator'}
          </span>
        )}
      </div>

      <nav className="flex-1 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span>{item.icon}</span>
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
                className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={logout}
          className="w-full text-sm text-gray-500 hover:text-red-600 text-left transition-colors"
        >
          Chiqish
        </button>
      </div>
    </aside>
  );
}
