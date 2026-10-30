import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/db/profile';
import { GUIDE_CHAPTERS, GuideNotFound, loadChapter } from '@/lib/guide';

export async function generateMetadata({ params }: PageProps<'/guide/[chapter]'>) {
  const { chapter } = await params;
  const title = GUIDE_CHAPTERS.find((c) => c.slug === chapter)?.title;
  return { title: title ?? 'ガイド' };
}

const navClass =
  'flex min-h-11 flex-1 items-center rounded-lg border border-gray-300 px-3 py-2 text-blue-700 dark:border-gray-700 dark:text-blue-400';

export default async function GuideChapterPage({ params }: PageProps<'/guide/[chapter]'>) {
  await requireProfile();
  const { chapter } = await params;

  const index = GUIDE_CHAPTERS.findIndex((c) => c.slug === chapter);
  if (index < 0) notFound();

  let html: string;
  try {
    html = await loadChapter(chapter);
  } catch (e) {
    if (e instanceof GuideNotFound) notFound();
    throw e;
  }

  const prev = GUIDE_CHAPTERS[index - 1];
  const next = GUIDE_CHAPTERS[index + 1];

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link href="/guide" className="inline-flex min-h-11 items-center text-blue-700 dark:text-blue-400">
        ← 目次へ
      </Link>
      {/* 章の本文は、リポジトリ内の自前の Markdown だけから作る（利用者の入力は入らない）。 */}
      <article className="guide-body" dangerouslySetInnerHTML={{ __html: html }} />
      <nav aria-label="前後の章" className="mt-8 flex flex-col gap-2 sm:flex-row">
        {prev ? (
          <Link href={`/guide/${prev.slug}`} className={navClass}>
            ← {prev.title}
          </Link>
        ) : (
          <span className="hidden flex-1 sm:block" />
        )}
        {next ? (
          <Link href={`/guide/${next.slug}`} className={`${navClass} justify-end text-right`}>
            {next.title} →
          </Link>
        ) : (
          <span className="hidden flex-1 sm:block" />
        )}
      </nav>
      <Link href="/guide" className="mt-2 flex min-h-11 items-center justify-center rounded-lg border border-gray-300 text-blue-700 dark:border-gray-700 dark:text-blue-400">
        目次へ
      </Link>
    </main>
  );
}
