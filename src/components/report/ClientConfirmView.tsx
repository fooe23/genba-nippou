'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { jpDateTime } from '@/lib/calc/format';
import { MAX_CONFIRM_ISSUES, signatureFormSchema } from '@/lib/report/client-signature';
import { CLIENT_DAILY_ISSUES_TITLE, NO_ISSUES_TODAY, type ClientIssueRow } from '@/lib/reports/client-daily-sections';
import { fieldClass, TextInput } from './inputs';
import { LongPressButton } from './LongPressButton';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { SIGN_FAILED_MESSAGE, uploadAndSaveSignature } from './sign-client';

// お客様用の確認画面の中身（2026-11-13）。お客様にスマホ・タブレットを渡して、本日の施工内容・確認していただく件・写真を
// 見てもらい、確認者・メモ・サインをもらう。社内の情報は props に入れない（page.tsx がお客様に見せてよいものだけ渡す）。
// 社内の画面に戻るのは、サインを保存したとき（自動で日報の画面へ）か、「社内の画面に戻る」を 1.5 秒長押ししたときだけ。

export type ClientConfirmIssue = ClientIssueRow & { id: string };

interface Props {
  siteId: string;
  reportId: string;
  /** 日報の版（updated_at）。サインの保存で比べる。 */
  expected: string | null;
  /** 社内の日報の画面。 */
  backHref: string;
  siteName: string;
  dateLabel: string;
  weather: string | null;
  workRows: { kind: string; trade: string; description: string; qty: string; unit: string }[];
  workersLine: string | null;
  /** 確認していただく件の候補（サイン済みなら、そのサインで確認していただいた件）。 */
  issues: ClientConfirmIssue[];
  initialSelected: string[];
  /** 「見積書あり」を出すか（社員・管理者のアカウントだけ）。 */
  showEstimate: boolean;
  photos: { id: string; url: string; caption: string }[];
  defaultConfirmedBy: string;
  defaultNote: string;
  signed: { confirmedBy: string; signedAt: string; note: string; imageUrl: string } | null;
}

const bigButton = 'min-h-12 rounded-lg px-4 text-lg font-bold disabled:opacity-50';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">{title}</h2>
      {children}
    </section>
  );
}

function IssueMeta({ issue, showEstimate }: { issue: ClientIssueRow; showEstimate: boolean }) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="rounded border border-current px-1.5 font-bold">{issue.statusLabel}</span>
      {showEstimate && issue.hasEstimate && <span>見積書あり</span>}
      <span>写真 {issue.photoCount > 0 ? `${issue.photoCount} 枚` : 'なし'}</span>
    </span>
  );
}

/** 写真を画面いっぱいに見せる（閉じる・背景を押す・Esc で閉じる）。 */
function PhotoLightbox({ photo, onClose }: { photo: Props['photos'][number]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption || '写真'}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex justify-end">
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-lg bg-white px-4 text-base font-bold text-gray-900">
          閉じる
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={photo.caption || '写真'} className="min-h-0 w-full flex-1 object-contain" />
      {photo.caption && <p className="mt-2 text-center break-words text-white">{photo.caption}</p>}
    </div>
  );
}

export function ClientConfirmView(p: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(p.initialSelected));
  const [by, setBy] = useState(p.defaultConfirmedBy);
  const [note, setNote] = useState(p.defaultNote);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [zoomed, setZoomed] = useState<Props['photos'][number] | null>(null);
  const pad = useRef<SignaturePadHandle | null>(null);
  // 二度押しの防止（state の更新を待たずに、同期で止める）
  const inFlight = useRef(false);

  function toggle(id: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    if (inFlight.current || saved) return;
    inFlight.current = true;
    try {
      const checked = signatureFormSchema.safeParse({ confirmedBy: by, note });
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? '入力内容が正しくありません');
        return;
      }
      const issueIds = p.issues.filter((i) => selected.has(i.id)).map((i) => i.id);
      if (issueIds.length > MAX_CONFIRM_ISSUES) {
        setError(`確認していただく件は ${MAX_CONFIRM_ISSUES} 件までです`);
        return;
      }
      const png = await pad.current?.toPng();
      if (!png) return;
      if ('error' in png) {
        setError(png.error);
        return;
      }
      setError(null);
      setSending(true);
      const res = await uploadAndSaveSignature({
        siteId: p.siteId,
        reportId: p.reportId,
        png: png.blob,
        confirmedBy: checked.data.confirmedBy,
        note: checked.data.note,
        issueIds,
        expected: p.expected,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      // 保存してもお客様用の画面のまま（スマホがお客様の手にあるうちに社内の画面を出さない。2026-11-08）。
      // サイン済みの表示（ありがとうございました）に読み直し、社内の画面へは長押しで戻る。
      router.refresh();
    } catch (e) {
      console.error('[client confirm]', e);
      setError(SIGN_FAILED_MESSAGE);
    } finally {
      setSending(false);
      inFlight.current = false;
    }
  }

  const busy = sending || saved;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-3 pb-[calc(2rem+env(safe-area-inset-bottom))] text-base">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-bold text-gray-600 dark:text-gray-400">ご確認のお願い</p>
          <h1 className="text-xl font-bold break-words">{p.siteName}</h1>
          <p className="mt-1">
            {p.dateLabel}
            <span className="ml-3">天候：{p.weather || '—'}</span>
          </p>
        </div>
        <LongPressButton
          onComplete={() => router.replace(p.backHref)}
          disabled={sending}
          description="社内の画面に戻るには、このボタンを 1.5 秒押し続けます"
          className="shrink-0 border border-gray-400 px-3 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          社内の画面に戻る（長押し）
        </LongPressButton>
      </div>

      <Section title="本日の施工内容">
        {p.workRows.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">本日の施工内容はありません。</p>
        ) : (
          <>
            {/* スマホ：1 行ずつカード、広い画面：表 */}
            <ul className="space-y-2 md:hidden">
              {p.workRows.map((r, i) => (
                <li key={i} className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="mr-2 rounded border border-current px-1.5 font-bold">{r.kind}</span>
                    {r.trade}
                  </p>
                  <p className="mt-1 break-words whitespace-pre-wrap">{r.description}</p>
                  {(r.qty !== '' || r.unit !== '') && (
                    <p className="mt-1 text-right tabular-nums">
                      {r.qty} {r.unit}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <table className="hidden w-full border-collapse text-left md:table">
              <thead>
                <tr className="border-b border-gray-300 text-sm dark:border-gray-700">
                  <th className="py-2 pr-2">区分</th>
                  <th className="py-2 pr-2">工種</th>
                  <th className="py-2 pr-2">施工内容</th>
                  <th className="py-2 pr-2 text-right">数量</th>
                  <th className="py-2">単位</th>
                </tr>
              </thead>
              <tbody>
                {p.workRows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-200 align-top dark:border-gray-800">
                    <td className="py-2 pr-2 whitespace-nowrap">{r.kind}</td>
                    <td className="py-2 pr-2">{r.trade}</td>
                    <td className="py-2 pr-2 break-words whitespace-pre-wrap">{r.description}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.qty}</td>
                    <td className="py-2">{r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {p.workersLine && <p className="font-bold">{p.workersLine}</p>}
      </Section>

      {p.signed ? (
        <Section title={CLIENT_DAILY_ISSUES_TITLE}>
          {p.issues.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">{NO_ISSUES_TODAY}</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-300 dark:divide-gray-800 dark:border-gray-700">
              {p.issues.map((i) => (
                <li key={i.id} className="p-3">
                  <p className="break-words whitespace-pre-wrap">
                    <span className="mr-2 font-bold tabular-nums">{i.number}</span>
                    <span className="mr-2 text-sm">［{i.kindLabel}］</span>
                    {i.body}
                  </p>
                  <IssueMeta issue={i} showEstimate={p.showEstimate} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <Section title={CLIENT_DAILY_ISSUES_TITLE}>
          {p.issues.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">確認していただく件はありません。</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">印を付けた件を、サインで確認していただいたものとして記録します。</p>
              <ul className="divide-y divide-gray-200 rounded-lg border border-gray-300 dark:divide-gray-800 dark:border-gray-700">
                {p.issues.map((i) => (
                  <li key={i.id}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        disabled={busy}
                        onChange={(e) => toggle(i.id, e.target.checked)}
                        className="mt-0.5 h-6 w-6 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words whitespace-pre-wrap">
                          <span className="mr-2 font-bold tabular-nums">{i.number}</span>
                          <span className="mr-2 text-sm">［{i.kindLabel}］</span>
                          {i.body}
                        </span>
                        <IssueMeta issue={i} showEstimate={p.showEstimate} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {p.photos.length > 0 && (
        <Section title={`写真（${p.photos.length} 枚）`}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.photos.map((ph) => (
              <li key={ph.id} className="min-w-0">
                {ph.url ? (
                  // 新しいタブは開かない（お客様が社内の画面に移らないよう、この画面の中で大きく見せる）
                  <button type="button" onClick={() => setZoomed(ph)} className="block w-full" aria-label={`写真を大きく見る${ph.caption ? `：${ph.caption}` : ''}`}>
                    {/* 署名付き URL の画像（next/image の最適化は通さない） */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ph.url} alt={ph.caption || '写真'} loading="lazy" className="aspect-[4/3] w-full rounded border border-gray-300 bg-gray-100 object-cover dark:border-gray-700" />
                  </button>
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-gray-300 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                    写真を読み込めませんでした
                  </div>
                )}
                {ph.caption && <p className="mt-1 text-sm break-words">{ph.caption}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {zoomed && <PhotoLightbox photo={zoomed} onClose={() => setZoomed(null)} />}

      {p.signed ? (
        <Section title="お客様のサイン">
          <p className="break-words">
            確認者：<span className="font-bold">{p.signed.confirmedBy}</span>
            <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">{jpDateTime(p.signed.signedAt)}</span>
          </p>
          {p.signed.note && <p className="break-words whitespace-pre-wrap">メモ：{p.signed.note}</p>}
          {p.signed.imageUrl ? (
            // 署名付き URL の画像（next/image の最適化は通さない）
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.signed.imageUrl} alt={`${p.signed.confirmedBy}のサイン`} className="max-h-60 w-full rounded border border-gray-300 bg-white object-contain" />
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">サインの画像を読み込めませんでした。</p>
          )}
          <p className="font-bold">サインをいただきました。ありがとうございました。</p>
        </Section>
      ) : (
        <Section title="ご確認のサイン">
          <label className="block">
            <span className="mb-1 block font-medium">確認者（必須）</span>
            <TextInput value={by} maxLength={100} placeholder="例：施主 〇〇様" onChange={setBy} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">メモ（500文字まで）</span>
            <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} py-2`} />
          </label>
          <SignaturePad handleRef={pad} disabled={busy} heightClass="h-[clamp(200px,55vh,420px)]" onChange={() => setError(null)} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => pad.current?.clear()}
              disabled={busy}
              className={`${bigButton} flex-1 border border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400`}
            >
              書き直す
            </button>
            <button type="button" onClick={() => void save()} disabled={busy} className={`${bigButton} flex-1 bg-blue-700 text-white`}>
              {sending ? '保存中…' : saved ? '保存しました' : 'サインを保存'}
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">保存したサインは、後から書き直せません。確認者・日時・メモと一緒に残ります。</p>
          {error && (
            <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
              {error}
            </p>
          )}
        </Section>
      )}
    </main>
  );
}
