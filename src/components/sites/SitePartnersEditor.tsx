'use client';

import { useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import {
  addSitePartner,
  copySitePartners,
  removeSitePartner,
  setSitePartnerWorkers,
  updateSitePartner,
} from '@/lib/db/sites-actions';
import {
  EmptyText, ErrorText, Field, inputClass, numOrNull, primaryButtonClass, secondaryButtonClass, str, useRunner,
} from '@/components/masters/common';

export interface PartnerCardData {
  id: string;
  supplierId: string;
  supplierName: string;
  amount: number | null;
  note: string | null;
}
export interface PartnerWorkerChoice { id: string; name: string; trade: string | null; }
export interface SiteChoice { id: string; name: string; done: boolean; }

const MSG_AMOUNT = '請負金額は0以上の数値で入力してください（空欄可）';

function amountError(amount: number | null): string | null {
  return amount !== null && (!Number.isFinite(amount) || amount < 0) ? MSG_AMOUNT : null;
}

const dangerButtonClass =
  'min-h-11 rounded-lg border border-red-600 px-4 text-base font-medium text-red-700 disabled:opacity-50 dark:border-red-500 dark:text-red-400';

/**
 * 現場の「協力会社と作業員」：協力会社（請負金額・メモは任意）の追加・編集・削除、会社ごとの作業員の現場登録、
 * ほかの現場からのコピー。社員・管理者だけが使う（協力会社のアカウントにはページごと出さない）。完了現場は閲覧のみ。
 */
export function SitePartnersEditor({
  siteId,
  readOnly,
  partners,
  workersBySupplier,
  registeredWorkerIds,
  addable,
  otherSites,
}: {
  siteId: string;
  readOnly: boolean;
  partners: PartnerCardData[];
  /** 会社ごとの登録できる作業員（有効な作業員だけ）。 */
  workersBySupplier: Record<string, PartnerWorkerChoice[]>;
  /** この現場に登録済みの作業員（自社の選択も含む）。 */
  registeredWorkerIds: string[];
  /** 追加できる取引先（有効で、まだこの現場に無いもの）。 */
  addable: { id: string; name: string }[];
  otherSites: SiteChoice[];
}) {
  const registered = new Set(registeredWorkerIds);
  return (
    <div className="space-y-8">
      {partners.length === 0 ? (
        <EmptyText>この現場の協力会社はまだありません。</EmptyText>
      ) : (
        <ul className="space-y-4">
          {partners.map((p) => (
            <PartnerCard
              key={p.id}
              siteId={siteId}
              partner={p}
              workers={workersBySupplier[p.supplierId] ?? []}
              registered={registered}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      {!readOnly && <AddPartnerForm siteId={siteId} addable={addable} />}
      {!readOnly && <CopyFromSiteForm siteId={siteId} sites={otherSites} />}
    </div>
  );
}

function PartnerCard({
  siteId,
  partner,
  workers,
  registered,
  readOnly,
}: {
  siteId: string;
  partner: PartnerCardData;
  workers: PartnerWorkerChoice[];
  registered: Set<string>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const registeredIds = workers.filter((w) => registered.has(w.id)).map((w) => w.id);
  const registeredKey = registeredIds.join(',');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(registeredIds));
  // サーバーの登録が変わった（保存・ほかの現場からのコピー）ときは、チェックをサーバーの登録に合わせ直す。
  const [prevKey, setPrevKey] = useState(registeredKey);
  if (prevKey !== registeredKey) {
    setPrevKey(registeredKey);
    setChecked(new Set(registeredIds));
  }
  const [savedWorkers, setSavedWorkers] = useState(false);
  const remover = useRunner();
  const workerRunner = useRunner();
  const name = partner.supplierName || '（不明な取引先）';

  function toggle(id: string) {
    setSavedWorkers(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function saveWorkers() {
    setSavedWorkers(false);
    // 並びは一覧（名前順）。新しく登録した作業員はこの現場の最後に足される。
    const ids = workers.filter((w) => checked.has(w.id)).map((w) => w.id);
    workerRunner.runResult(() => setSitePartnerWorkers(siteId, partner.supplierId, ids), () => setSavedWorkers(true));
  }

  return (
    <li className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <h3 className="break-words text-lg font-bold">{name}</h3>
      {editing ? (
        <AmountForm partner={partner} onDone={() => setEditing(false)} />
      ) : (
        <div className="mt-1 space-y-1 text-sm">
          <p>
            請負金額：<span className="font-bold tabular-nums">{partner.amount === null ? '未入力' : yen(partner.amount)}</span>
          </p>
          {partner.note ? <p className="break-words text-gray-700 dark:text-gray-300">メモ：{partner.note}</p> : null}
          {!readOnly && (
            <button type="button" onClick={() => setEditing(true)} className={`${secondaryButtonClass} mt-1`}>
              請負金額・メモを編集
            </button>
          )}
        </div>
      )}

      <fieldset className="mt-4" disabled={readOnly}>
        <legend className="mb-1 font-bold">
          この現場で働く作業員
          <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">（{checked.size}人登録）</span>
        </legend>
        {workers.length === 0 ? (
          <p className="py-2 text-sm text-gray-600 dark:text-gray-400">
            この会社の有効な作業員がいません。管理者が マスター → 作業員 で所属を「協力会社」にして登録します。
          </p>
        ) : (
          <ul>
            {workers.map((w) => (
              <li key={w.id} className="border-b border-gray-300 dark:border-gray-700">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                  <input type="checkbox" checked={checked.has(w.id)} onChange={() => toggle(w.id)} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{w.name}</span>
                    {w.trade ? <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{w.trade}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {!readOnly && workers.length > 0 && (
          <div className="mt-2 space-y-2">
            <ErrorText message={workerRunner.error} />
            {savedWorkers && !workerRunner.error && (
              <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
                保存しました
              </p>
            )}
            <button type="button" disabled={workerRunner.pending} onClick={saveWorkers} className={`${primaryButtonClass} w-full`}>
              {workerRunner.pending ? '保存中…' : '作業員の登録を保存'}
            </button>
          </div>
        )}
      </fieldset>

      {!readOnly && (
        <div className="mt-4 space-y-2">
          <ErrorText message={remover.error} />
          <button
            type="button"
            disabled={remover.pending}
            onClick={() => {
              if (window.confirm(`${name} をこの現場から外します。この会社の作業員の登録も外れます。過去の日報は変わりません。よろしいですか？`)) {
                remover.runResult(() => removeSitePartner(partner.id));
              }
            }}
            className={`${dangerButtonClass} w-full`}
          >
            {remover.pending ? '処理中…' : 'この現場から外す'}
          </button>
        </div>
      )}
    </li>
  );
}

function AmountForm({ partner, onDone }: { partner: PartnerCardData; onDone: () => void }) {
  const { pending, error, setError, runResult } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = numOrNull(str(fd, 'amount'));
    const invalid = amountError(amount);
    if (invalid) {
      setError(invalid);
      return;
    }
    runResult(() => updateSitePartner({ id: partner.id, amount, note: str(fd, 'note') }), onDone);
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-3">
      <Field label="請負金額（円・任意）">
        <input
          name="amount"
          type="number"
          inputMode="numeric"
          min={0}
          step="any"
          defaultValue={partner.amount ?? ''}
          className={inputClass}
        />
      </Field>
      <Field label="メモ（任意）">
        <input name="note" maxLength={200} defaultValue={partner.note ?? ''} className={inputClass} />
      </Field>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className={`${secondaryButtonClass} flex-1`}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} flex-1`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}

function AddPartnerForm({ siteId, addable }: { siteId: string; addable: { id: string; name: string }[] }) {
  const { pending, error, setError, runResult } = useRunner();
  // 追加に成功したらフォームを作り直して空に戻す。
  const [formKey, setFormKey] = useState(0);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const supplierId = str(fd, 'supplierId');
    if (!supplierId) {
      setError('協力会社（取引先）を選んでください');
      return;
    }
    // すでにある会社は選択肢に出さない（追加し直すと請負金額・メモが上書きされるため）。
    if (!addable.some((s) => s.id === supplierId)) {
      setError('この協力会社はすでに追加されています');
      return;
    }
    const amount = numOrNull(str(fd, 'amount'));
    const invalid = amountError(amount);
    if (invalid) {
      setError(invalid);
      return;
    }
    runResult(
      async () => {
        const res = await addSitePartner({ siteId, supplierId, amount, note: str(fd, 'note') });
        return res.ok ? { ok: true } : res;
      },
      () => setFormKey((k) => k + 1),
    );
  }

  return (
    <section aria-labelledby="add-partner" className="space-y-3">
      <h2 id="add-partner" className="border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">
        協力会社を追加
      </h2>
      {addable.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          追加できる取引先がありません。協力会社は管理者が マスター → 取引先 で登録します。
        </p>
      ) : (
        <form key={formKey} onSubmit={submit} className="space-y-3">
          <Field label="協力会社（取引先）">
            <select name="supplierId" defaultValue="" className={inputClass}>
              <option value="">選んでください</option>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="請負金額（円・任意）">
            <input name="amount" type="number" inputMode="numeric" min={0} step="any" className={inputClass} />
          </Field>
          <Field label="メモ（任意）">
            <input name="note" maxLength={200} className={inputClass} />
          </Field>
          <ErrorText message={error} />
          <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
            {pending ? '追加中…' : '追加'}
          </button>
        </form>
      )}
    </section>
  );
}

function CopyFromSiteForm({ siteId, sites }: { siteId: string; sites: SiteChoice[] }) {
  const { pending, error, setError, runResult } = useRunner();
  const [from, setFrom] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function copy() {
    setMessage(null);
    if (!from) {
      setError('コピー元の現場を選んでください');
      return;
    }
    runResult(async () => {
      const res = await copySitePartners(from, siteId);
      if (!res.ok) return res;
      setMessage(res.message);
      return { ok: true };
    });
  }

  return (
    <section aria-labelledby="copy-partners" className="space-y-3">
      <h2 id="copy-partners" className="border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">
        ほかの現場からコピー
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        選んだ現場の協力会社と、作業員の登録をまとめて写します。請負金額・メモと無効な作業員は写しません。すでにあるものはそのままです。
      </p>
      {sites.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">ほかの現場がありません。</p>
      ) : (
        <>
          <Field label="コピー元の現場">
            <select
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setMessage(null);
              }}
              className={inputClass}
            >
              <option value="">選んでください</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.done ? `${s.name}（完了）` : s.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorText message={error} />
          {message && (
            <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
              {message}
            </p>
          )}
          <button type="button" disabled={pending} onClick={copy} className={`${secondaryButtonClass} w-full`}>
            {pending ? 'コピー中…' : 'この現場にコピー'}
          </button>
        </>
      )}
    </section>
  );
}
