'use client';

import { fileExtension } from '@/lib/db/attachments-schemas';
import { jpDate } from '@/lib/calc/format';
import type { AttachmentView } from './types';

const smallBtn =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-600 px-2 text-sm font-bold text-red-700 disabled:opacity-50 dark:border-red-500 dark:text-red-400';

/** リンクの表示用のホスト名（読めなければ空）。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 添付の一覧：写真（小さな写真。左上のチェック＝お客様用 PDF に載せる。押すと大きく表示）、
 * ファイル（名前のタイル。押すと別タブで開く）、リンク（押すと別タブで開く）。
 * 協力会社にはファイルの行が来ない（RLS）が、showFiles=false なら念のため出さない。
 */
export function AttachmentThumbs({
  items,
  showFiles,
  canToggle,
  onToggle,
  busyIds,
  canDelete,
  onDelete,
  onOpenPhoto,
}: {
  items: AttachmentView[];
  showFiles: boolean;
  canToggle: (a: AttachmentView) => boolean;
  onToggle: (a: AttachmentView, visible: boolean) => void;
  /** 切替・削除の処理中の添付（ボタンを止める）。 */
  busyIds: ReadonlySet<string>;
  /** ファイル・リンクの「消す」を出すか（写真は大きく表示した画面で消す）。 */
  canDelete: (a: AttachmentView) => boolean;
  onDelete: (a: AttachmentView) => void;
  /** 写真の並び（kind = 'photo' だけ）の何番目を開くか。 */
  onOpenPhoto: (photoIndex: number) => void;
}) {
  const photos = items.filter((a) => a.kind === 'photo');
  const files = showFiles ? items.filter((a) => a.kind === 'file') : [];
  const links = items.filter((a) => a.kind === 'link');
  if (photos.length + files.length + links.length === 0) return null;

  return (
    <div className="space-y-2">
      {(photos.length > 0 || files.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((a, i) => {
            const toggle = canToggle(a);
            return (
              <li key={a.id} className="w-24">
                <div className="relative h-24 w-24">
                  <button
                    type="button"
                    onClick={() => onOpenPhoto(i)}
                    className="block h-full w-full overflow-hidden rounded-lg border border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
                    aria-label={`写真「${a.name}」を大きく表示`}
                  >
                    {a.href ? (
                      // 署名付き URL（期限つき）なので next/image は使わない
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.href} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs">読み込めません</span>
                    )}
                  </button>
                  {toggle ? (
                    <label
                      className="absolute left-0 top-0 flex h-11 w-11 cursor-pointer items-start justify-start p-1.5"
                      title="お客様用 PDF に載せる"
                    >
                      <input
                        type="checkbox"
                        checked={a.clientVisible}
                        disabled={busyIds.has(a.id)}
                        onChange={(e) => onToggle(a, e.target.checked)}
                        className="h-5 w-5 accent-blue-700"
                      />
                      <span className="sr-only">お客様用 PDF に載せる（{a.name}）</span>
                    </label>
                  ) : (
                    a.clientVisible && (
                      <span
                        className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded bg-blue-700 text-xs font-bold text-white"
                        title="お客様用 PDF に載せる"
                      >
                        ✓<span className="sr-only">お客様用 PDF に載せる</span>
                      </span>
                    )
                  )}
                </div>
                <p className="truncate text-xs text-gray-700 dark:text-gray-300">{a.caption || jpDate(a.attachedOn)}</p>
              </li>
            );
          })}
          {files.map((a) => (
            <li key={a.id} className="w-24">
              <a
                href={a.href || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-24 w-24 flex-col items-center justify-center overflow-hidden rounded-lg border border-red-300 bg-red-50 p-1 text-center text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100"
                aria-label={`ファイル「${a.name}」を開く`}
              >
                <span className="text-sm font-bold">{(fileExtension(a.name) ?? 'file').toUpperCase()}</span>
                <span className="line-clamp-3 break-all text-xs">{a.name}</span>
              </a>
              {canDelete(a) && (
                <button type="button" onClick={() => onDelete(a)} disabled={busyIds.has(a.id)} className={`${smallBtn} mt-1 w-full`}>
                  消す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">ファイル（PDF など）はお客様用には載りません（社内で見るだけ）。</p>}
      {links.length > 0 && (
        <ul className="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {links.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <a
                href={a.href || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 min-w-0 flex-1 items-center gap-1 break-all py-1 text-blue-700 underline dark:text-blue-400"
              >
                <span aria-hidden="true">🔗</span>
                <span className="min-w-0">
                  {a.name}
                  {a.url && <span className="ml-1 text-xs text-gray-600 no-underline dark:text-gray-400">（{hostOf(a.url)}）</span>}
                </span>
              </a>
              {canDelete(a) && (
                <button type="button" onClick={() => onDelete(a)} disabled={busyIds.has(a.id)} className={`${smallBtn} shrink-0`}>
                  消す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
