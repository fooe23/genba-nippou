'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from 'react';
import {
  addLink,
  commitAttachment,
  deleteAttachment,
  prepareUpload,
  setAttachmentClientVisible,
} from '@/lib/db/attachments-actions';
import {
  FILE_ACCEPT,
  FILE_NOT_ALLOWED_MESSAGE,
  FILE_TYPES,
  canonicalFileMime,
  fileExtension,
  MAX_ATTACHMENT_BYTES,
  MSG_FILE_TYPE,
  type UploadInput,
  type UploadKind,
} from '@/lib/db/attachments-schemas';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { AttachmentThumbs } from './AttachmentThumbs';
import { compressPhoto, isPhotoFile, photoName, PHOTO_UNREADABLE_MESSAGE } from './compress';
import { Lightbox } from './Lightbox';
import {
  canDeleteAttachment,
  canToggleClientVisible,
  defaultLinkName,
  fitAttachmentName,
  type AttachmentView,
  type AttachmentViewer,
} from './types';

export type AttachmentTarget = { siteId: string; reportId: string } | { siteId: string; issueId: string };

type UploadStatus = 'waiting' | 'shrinking' | 'sending' | 'done' | 'error';
interface UploadItem {
  key: string;
  name: string;
  status: UploadStatus;
  error?: string;
}

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const SEND_FAILED = '送れませんでした。通信状況を確かめて、もう一度付けてください';
const TOO_LARGE = '1 つ 10MB までです（大きいものは G ドライブに置いてリンクを付けてください）';
/** 同時に送る数（スマホの回線と端末の負担を抑える）。 */
const CONCURRENCY = 2;

const btnBase = 'flex min-h-11 w-full items-center justify-center gap-1 rounded-lg px-3 text-base font-bold disabled:opacity-50';
const btnPrimary = `${btnBase} bg-blue-700 text-white`;
const btnOutline = `${btnBase} border border-blue-700 bg-white text-blue-700 dark:border-blue-400 dark:bg-transparent dark:text-blue-400`;
const inputClass =
  'block min-h-11 w-full min-w-0 rounded-lg border border-gray-400 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

const STATUS_TEXT: Record<UploadStatus, string> = {
  waiting: '順番待ち',
  shrinking: '写真を軽くしています…',
  sending: '送っています…',
  done: '付けました',
  error: '付けられませんでした',
};

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * 日報・件の添付の欄。ドロップ枠・ボタン（写真を撮る・写真を選ぶ・ファイル・リンク）・付けたものの一覧。
 * - 写真は端末で縮めてから送る（長い辺 1600px の JPEG。元の写真は送らない）。ファイルは縮めず 10MB まで。
 * - いくつでもまとめて選べる・ドロップできる（2 つずつ送り、1 つずつ進み具合と失敗を出す）。
 * - locked（提出後の日報・完了した件・完了現場）のときは足す・消すを出さず、lockedNotice を出す。お客様用のチェックは残す。
 * - canAddFiles=false（協力会社）はファイルのボタンを出さない（ファイルの行も来ない）。
 * - collapsible（件ごと）のときは「＋ 写真・見積書・リンクを付ける」を押すと付ける欄が開く。
 */
export function AttachmentPanel({
  target,
  attachments,
  canAddFiles,
  locked,
  lockedNotice,
  viewer,
  collapsible = false,
}: {
  target: AttachmentTarget;
  attachments: AttachmentView[];
  canAddFiles: boolean;
  locked: boolean;
  lockedNotice?: string;
  viewer: AttachmentViewer;
  collapsible?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(!collapsible);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropHint, setDropHint] = useState(false);

  // 枠の外に落としたファイルでブラウザがページを離れない（ファイルを開いてしまう）ように、画面全体のドロップを止める。
  // 枠（data-attachment-drop）の外では「落とせない」表示にし、日報の欄（collapsible でない欄）が「点線の枠の中に」と案内する。
  // 件ごとの欄もそれぞれ同じ止め方をする（何度止めても害はない）。
  useEffect(() => {
    const outside = (e: Event) => !(e.target instanceof Element && e.target.closest('[data-attachment-drop]'));
    const hasFiles = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    function onWindowDragOver(e: globalThis.DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (outside(e) && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    }
    function onWindowDrop(e: globalThis.DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (outside(e) && !collapsible) setDropHint(true);
    }
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [collapsible]);

  // サーバーから新しい一覧が届いたら、手元の切替・削除の上書きと「付けました」の行を片づける
  const [seen, setSeen] = useState(attachments);
  if (attachments !== seen) {
    setSeen(attachments);
    setOverrides({});
    setRemoved(new Set());
    setUploads((u) => u.filter((x) => x.status !== 'done'));
  }

  const items = attachments
    .filter((a) => !removed.has(a.id) && (canAddFiles || a.kind !== 'file'))
    .map((a) => (a.id in overrides ? { ...a, clientVisible: overrides[a.id] } : a));
  const photos = items.filter((a) => a.kind === 'photo');
  const isIssue = 'issueId' in target;
  const canAdd = !locked;

  function setBusyId(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function updateUpload(key: string, patch: Partial<UploadItem>) {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }

  function targetFields(): Pick<UploadInput, 'siteId' | 'reportId' | 'issueId' | 'reportDate'> {
    return 'issueId' in target
      ? { siteId: target.siteId, issueId: target.issueId, reportDate: viewer.reportDate }
      : { siteId: target.siteId, reportId: target.reportId };
  }

  /**
   * 1 つ付ける。付けられたら true。kind は使った入口で決める（写真のボタン・画像のドロップ＝写真、
   * 「ファイルを選ぶ」・画像以外のドロップ＝ファイル。スキャンした見積書の JPEG もファイルとして縮めずに置く）。
   */
  async function uploadOne(file: File, key: string, kind: UploadKind): Promise<boolean> {
    const fail = (msg: string) => {
      updateUpload(key, { status: 'error', error: msg });
      return false;
    };
    const photo = kind === 'photo';
    let blob: Blob = file;
    let name: string;
    let mime: string;
    if (photo) {
      updateUpload(key, { status: 'shrinking' });
      try {
        blob = await compressPhoto(file);
      } catch {
        return fail(PHOTO_UNREADABLE_MESSAGE);
      }
      name = photoName(file.name);
      mime = 'image/jpeg';
    } else {
      if (!canAddFiles) return fail(FILE_NOT_ALLOWED_MESSAGE);
      name = fitAttachmentName(file.name);
      const ext = fileExtension(name);
      const allowed = ext ? FILE_TYPES[ext] : undefined;
      if (!allowed) return fail(MSG_FILE_TYPE);
      // ブラウザの申告が許可の組に無い（空・application/zip など）なら拡張子の標準の mime（サーバーも同じ判定）
      mime = canonicalFileMime(name, file.type);
    }
    if (blob.size === 0) return fail('空のファイルは付けられません');
    if (blob.size > MAX_ATTACHMENT_BYTES) return fail(TOO_LARGE);

    updateUpload(key, { status: 'sending' });
    const input: UploadInput = { ...targetFields(), kind, name, mime, sizeBytes: blob.size };
    // supabase-js は Blob・File の本文では contentType ではなく Blob の type を送るので、決めた mime の File に包み直す
    // （mime が空の .xlsx などでも gn-estimates の allowed_mime_types を通るように）
    const body = new File([blob], name, { type: mime });
    try {
      const prep = await prepareUpload(input);
      if (!prep.ok) return fail(prep.error);
      const { error: upError } = await createBrowserSupabase()
        .storage.from(prep.bucket)
        .upload(prep.path, body, { contentType: mime, upsert: false });
      if (upError) {
        console.error('[upload]', upError.message);
        return fail(SEND_FAILED);
      }
      const res = await commitAttachment({ ...input, attachmentId: prep.attachmentId });
      if (!res.ok) return fail(res.error);
      updateUpload(key, { status: 'done' });
      return true;
    } catch (e) {
      console.error('[upload]', e);
      return fail(SEND_FAILED);
    }
  }

  /** mode：photo＝写真のボタン（すべて写真）、file＝「ファイルを選ぶ」（すべてファイル）、drop＝画像は写真・それ以外はファイル。 */
  async function addFiles(list: File[], mode: 'photo' | 'file' | 'drop') {
    if (list.length === 0 || !canAdd) return;
    setError(null);
    const queued = list.map((f) => ({
      file: f,
      key: newKey(),
      kind: (mode === 'drop' ? (isPhotoFile(f) ? 'photo' : 'file') : mode) satisfies UploadKind,
    }));
    setUploads((u) => [...u.filter((x) => x.status !== 'error'), ...queued.map((q) => ({ key: q.key, name: q.file.name, status: 'waiting' as const }))]);
    let next = 0;
    let added = 0;
    async function worker() {
      while (next < queued.length) {
        const q = queued[next++];
        if (await uploadOne(q.file, q.key, q.kind)) added += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
    if (added > 0) startTransition(() => router.refresh());
  }

  function onPicked(e: ChangeEvent<HTMLInputElement>, mode: 'photo' | 'file') {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 同じファイルをもう一度選べるように
    void addFiles(files, mode);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    setDropHint(false);
    void addFiles(Array.from(e.dataTransfer.files ?? []), 'drop');
  }

  async function toggle(a: AttachmentView, visible: boolean) {
    setError(null);
    setOverrides((o) => ({ ...o, [a.id]: visible }));
    setBusyId(a.id, true);
    try {
      const res = await setAttachmentClientVisible(a.id, visible);
      if (!res.ok) {
        setOverrides((o) => ({ ...o, [a.id]: !visible }));
        setError(res.error);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setOverrides((o) => ({ ...o, [a.id]: !visible }));
      setError(FAILED);
    } finally {
      setBusyId(a.id, false);
    }
  }

  async function remove(a: AttachmentView) {
    const what = a.kind === 'photo' ? 'この写真' : `「${a.name}」`;
    if (!window.confirm(`${what}を消しますか？元に戻せません。`)) return;
    setError(null);
    setBusyId(a.id, true);
    try {
      const res = await deleteAttachment(a.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRemoved((r) => new Set(r).add(a.id));
      setLightbox(null);
      startTransition(() => router.refresh());
    } catch {
      setError(FAILED);
    } finally {
      setBusyId(a.id, false);
    }
  }

  async function submitLink() {
    if (linkPending) return;
    setLinkError(null);
    const url = linkUrl.trim();
    if (url === '') {
      setLinkError('リンク（URL）を入力してください');
      return;
    }
    const name = linkName.trim() || defaultLinkName(url);
    setLinkPending(true);
    try {
      const res = await addLink({ ...targetFields(), url, name });
      if (!res.ok) {
        setLinkError(res.error);
        return;
      }
      setLinkUrl('');
      setLinkName('');
      setLinkOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setLinkError(FAILED);
    } finally {
      setLinkPending(false);
    }
  }

  const canDel = (a: AttachmentView) => canAdd && canDeleteAttachment(a, viewer);
  const lightboxPhoto = lightbox !== null ? photos[lightbox] : undefined;
  const addLabel = canAddFiles ? '＋ 写真・見積書・リンクを付ける' : '＋ 写真・リンクを付ける';

  return (
    <div className="min-w-0 space-y-2">
      {collapsible && canAdd && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`${btnOutline} ${open ? 'bg-blue-50 dark:bg-blue-950' : ''}`}
        >
          {open ? '付ける欄を閉じる' : addLabel}
        </button>
      )}

      {canAdd && open && (
        <div className="space-y-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDragOver(false);
            }}
            onDrop={onDrop}
            data-attachment-drop=""
            className={`hidden rounded-lg border-2 border-dashed p-4 text-center md:block ${
              dragOver ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100' : 'border-gray-400 text-gray-700 dark:border-gray-600 dark:text-gray-300'
            }`}
          >
            <p className="font-bold">ここに{canAddFiles ? '写真・ファイル' : '写真'}をドラッグ＆ドロップ</p>
            <p className="text-sm">まとめて何枚でも。またはボタンから選ぶ（写真は自動で軽くします）</p>
          </div>
          {dropHint && (
            <p role="status" className="hidden text-sm font-bold text-blue-800 md:block dark:text-blue-300">
              ファイルは点線の枠の中に落としてください（枠の外に落としたものは付けていません）。
            </p>
          )}
          <p className="text-sm text-gray-600 md:hidden dark:text-gray-400">写真は自動で軽くします。まとめて何枚でも選べます。</p>

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPicked(e, 'photo')} />
          <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPicked(e, 'photo')} />
          {canAddFiles && <input ref={fileRef} type="file" accept={FILE_ACCEPT} multiple className="hidden" onChange={(e) => onPicked(e, 'file')} />}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
            <button type="button" onClick={() => cameraRef.current?.click()} className={`${btnPrimary} md:hidden`}>
              📷 写真を撮る
            </button>
            <button type="button" onClick={() => photoRef.current?.click()} className={btnPrimary}>
              🖼 写真を選ぶ<span className="hidden md:inline">（スクリーンショットも）</span>
            </button>
          </div>
          {canAddFiles && (
            <button type="button" onClick={() => fileRef.current?.click()} className={btnOutline}>
              📎 ファイル（PDF など）を選ぶ
            </button>
          )}
          <button type="button" onClick={() => setLinkOpen((o) => !o)} aria-expanded={linkOpen} className={btnOutline}>
            🔗 リンク（G ドライブなど）を付ける
          </button>

          {linkOpen && (
            <div className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-700">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">リンク（URL）</span>
                <input
                  type="url"
                  inputMode="url"
                  value={linkUrl}
                  maxLength={2000}
                  placeholder="https://drive.google.com/..."
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">名前（空なら「{linkUrl.trim() ? defaultLinkName(linkUrl) : 'G ドライブ など'}」）</span>
                <input
                  type="text"
                  value={linkName}
                  maxLength={100}
                  placeholder="例：11/6 指示の写真一式"
                  onChange={(e) => setLinkName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">G ドライブは共有の設定を「リンクを知っている全員」か、見る人を追加してから貼ってください。</p>
              <div className="flex gap-2">
                <button type="button" onClick={submitLink} disabled={linkPending} className={btnPrimary}>
                  リンクを付ける
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLinkOpen(false);
                    setLinkError(null);
                  }}
                  className={`${btnBase} border border-gray-400 dark:border-gray-600`}
                >
                  やめる
                </button>
              </div>
              {linkError && (
                <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
                  {linkError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-1" aria-live="polite">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                u.status === 'error'
                  ? 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-50'
                  : 'border-gray-300 dark:border-gray-700'
              }`}
            >
              <span className="min-w-0 flex-1 break-all">
                <span className="font-medium">{u.name}</span>：{STATUS_TEXT[u.status]}
                {u.error && <span className="block">{u.error}</span>}
              </span>
              {u.status === 'error' && (
                <button
                  type="button"
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-red-500 text-sm"
                  aria-label={`${u.name} の表示を消す`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {locked && lockedNotice && <p className="text-sm text-gray-700 dark:text-gray-300">{lockedNotice}</p>}

      {items.length > 0 && (
        <>
          {!collapsible && <h3 className="mt-3 font-bold">付けたもの（{items.length}）</h3>}
          {photos.length > 0 && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              左上の ☑ ＝ お客様用 PDF に載せる{isIssue ? '' : '（件に付けた写真は最初から ☑）'}。写真を押すと大きく表示します。
            </p>
          )}
          <AttachmentThumbs
            items={items}
            showFiles={canAddFiles}
            canToggle={(a) => canToggleClientVisible(a, viewer)}
            onToggle={(a, v) => void toggle(a, v)}
            busyIds={busy}
            canDelete={canDel}
            onDelete={(a) => void remove(a)}
            onOpenPhoto={setLightbox}
          />
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}

      {lightbox !== null && lightboxPhoto && (
        <Lightbox
          photos={photos}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onDelete={canDel(lightboxPhoto) ? (a) => void remove(a) : undefined}
          deleting={busy.has(lightboxPhoto.id)}
        />
      )}
    </div>
  );
}
