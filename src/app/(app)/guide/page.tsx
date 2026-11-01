import Link from 'next/link';
import { requireProfile } from '@/lib/db/profile';
import { GUIDE_CHAPTERS } from '@/lib/guide';
import { Chevron, linkTitleClass, rowLinkClass } from '@/components/ui/tappable';

export const metadata = { title: 'ガイド' };

export default async function GuideIndexPage() {
  await requireProfile();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-bold">ガイド</h1>
      <ol className="divide-y divide-gray-300 rounded-lg border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
        {GUIDE_CHAPTERS.map((c, i) => (
          <li key={c.slug}>
            <Link href={`/guide/${c.slug}`} className={`flex min-h-11 items-center gap-3 px-3 py-2 ${rowLinkClass}`}>
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-600 dark:text-gray-400">{i + 1}</span>
              <span className={`min-w-0 flex-1 ${linkTitleClass}`}>{c.title}</span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
