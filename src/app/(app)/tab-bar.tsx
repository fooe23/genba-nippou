'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface TabItem {
  href: string;
  label: string;
}

/** badges: href → 件数。0 のときは表示しない。 */
export function TabBar({ tabs, badges = {} }: { tabs: TabItem[]; badges?: Record<string, number> }) {
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
          const count = badges[tab.href] ?? 0;
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
                {count > 0 && (
                  <span
                    aria-label={`${count}件`}
                    className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white"
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
