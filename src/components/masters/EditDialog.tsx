'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** ネイティブ <dialog> を使った編集モーダル。open が false の間は中身を描画しない（入力状態がリセットされる）。 */
export function EditDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // 背景（backdrop）のタップで閉じる
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      {open ? (
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="min-h-11 min-w-11 rounded-lg text-xl"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
