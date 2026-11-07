import type { Metadata } from 'next';
import Link from 'next/link';
import { PdfViewer } from '@/components/pdf/PdfViewer';
import { requireProfile } from '@/lib/db/profile';
import { downloadHref, normalizeTitle, validateBackPath, validatePdfSrc } from '@/lib/pdf-viewer';

// アプリの中の PDF ビューアー。/pdf?src=<帳票の API>&title=<見出し>&back=<戻り先>
// 新しいタブで開くと、スマホ（とくにホーム画面に追加したとき）では戻る手段が無くなるので、同じ画面の中で開いて
// 上の帯の「戻る」「保存」「共有」で操作する。下のタブバーは出さない（(app) の外の route group）。
// src は帳票の API だけ（lib/pdf-viewer の validatePdfSrc）。PDF の中身の権限は各 API が見る。

export const metadata: Metadata = { title: 'PDF' };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PdfPage({ searchParams }: PageProps<'/pdf'>) {
  await requireProfile();
  const sp = await searchParams;
  const src = validatePdfSrc(first(sp.src));
  const title = normalizeTitle(first(sp.title)) ?? 'PDF';
  const back = validateBackPath(first(sp.back));
  const download = src ? downloadHref(src) : null;

  if (!src || !download) {
    return (
      <main className="mx-auto w-full max-w-xl space-y-4 p-4">
        <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
          開く PDF の指定が正しくありません。
        </p>
        <Link href={back ?? '/'} className="inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
          ← 戻る
        </Link>
      </main>
    );
  }

  return <PdfViewer src={src} downloadHref={download} title={title} back={back} />;
}
