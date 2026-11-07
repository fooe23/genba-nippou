'use client';

import { useEffect, useRef } from 'react';
import { jpDate } from '@/lib/calc/format';
import type { AttachmentView } from './types';

const btn =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/60 px-3 text-base font-bold text-white disabled:opacity-40';

/**
 * 写真を大きく表示する（画面いっぱいの黒い枠）。前後の写真に移れる。Esc・「閉じる」・枠の外を押すと閉じる。
 * onDelete があれば「この写真を消す」を出す（消せる人・消せる状態のときだけ渡す）。
 */
export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onDelete,
  deleting = false,
}: {
  photos: AttachmentView[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete?: (a: AttachmentView) => void;
  deleting?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index];
  const count = photos.length;

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < count - 1) onIndex(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onClose, onIndex]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="写真を大きく表示"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm">
          {index + 1} / {count}　{photo.name}
        </p>
        <button ref={closeRef} type="button" onClick={onClose} className={btn}>
          閉じる
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center py-2"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {photo.href ? (
          // 署名付き URL（期限つき）の写真なので next/image は使わない
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.href} alt={photo.caption || photo.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <p>写真を読み込めませんでした。画面を再読み込みしてください。</p>
        )}
      </div>
      <p className="break-words text-sm">
        {photo.caption && <span className="mr-2">{photo.caption}</span>}
        <span className="text-white/80">
          {jpDate(photo.attachedOn)}
          {photo.createdByName && `・${photo.createdByName}`}
          {photo.clientVisible ? '・お客様用に載せる' : ''}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0} className={btn} aria-label="前の写真">
          ◀ 前
        </button>
        <button type="button" onClick={() => onIndex(index + 1)} disabled={index >= count - 1} className={btn} aria-label="次の写真">
          次 ▶
        </button>
        {photo.href && (
          <a href={photo.href} target="_blank" rel="noopener noreferrer" className={btn}>
            別のタブで開く
          </a>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(photo)}
            disabled={deleting}
            className={`${btn} ml-auto border-red-400 text-red-200`}
          >
            この写真を消す
          </button>
        )}
      </div>
    </div>
  );
}
