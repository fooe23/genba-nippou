import Link from 'next/link';

const ITEMS = [
  { key: 'sites', href: '/admin/sites', label: '現場' },
  { key: 'masters', href: '/admin/masters', label: 'マスター' },
  { key: 'accounts', href: '/admin/accounts', label: 'アカウント' },
] as const;

/** 管理画面のサブナビ（現場／マスター／アカウント）。 */
export function AdminNav({ current }: { current: (typeof ITEMS)[number]['key'] }) {
  return (
    <nav aria-label="管理メニュー" className="mb-4 flex gap-2">
      {ITEMS.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          className={
            i.key === current
              ? 'flex min-h-11 items-center rounded-lg bg-blue-700 px-4 text-base font-bold text-white'
              : 'flex min-h-11 items-center rounded-lg border border-gray-400 px-4 text-base font-medium dark:border-gray-600'
          }
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
