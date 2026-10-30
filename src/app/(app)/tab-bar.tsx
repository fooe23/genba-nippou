'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface TabItem {
  href: string;
  label: string;
}

export function TabBar({ tabs }: { tabs: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-300 bg-background pb-[env(safe-area-inset-bottom)] dark:border-gray-700"
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const active =
            tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 items-center justify-center text-sm font-bold ${
                  active ? 'text-blue-700 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
