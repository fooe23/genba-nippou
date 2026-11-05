'use client';

import { useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import {
  addSitePartner,
  addSitePartnerWorker,
  copySitePartners,
  removeSitePartner,
  setSitePartnerWorkers,
  updateSitePartner,
} from '@/lib/db/sites-actions';
import { parseYenInput, partnerAmountError, sitePartnerWorkerAddSchema } from '@/lib/db/sites-schemas';
import { firstError } from '@/lib/db/masters-schemas';
import {
  EmptyText, ErrorText, Field, inputClass, primaryButtonClass, secondaryButtonClass, str, useRunner,
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
/** 残業単価を空欄にしたときの計算（設定）。 */
export interface OvertimeHint { baseHours: number; multiplier: number; }


const dangerButtonClass =
  'min-h-11 rounded-lg border border-red-600 px-4 text-base font-medium text-red-700 disabled:opacity-50 dark:border-red-500 dark:text-red-400';
/** 青い枠のボタン（新しい作業員の登録）。 */
const outlineBlueButtonClass =
  'min-h-11 rounded-lg border-2 border-blue-700 px-4 text-base font-bold text-blue-700 disabled:opacity-50 dark:border-blue-400 dark:text-blue-400';
/** 区切りのはっきりした枠（協力会社の追加・ほかの現場からコピー）。 */
const sectionCardClass = 'space-y-3 rounded-lg border border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900';
const sectionHeadingClass = 'text-lg font-bold';

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
  overtimeHint,
}: {
  siteId: string;
  readOnly: boolean;
  partners: PartnerCardData[];
  /** 会社ごとの登録できる作業員（有効な作業員だけ）。 */
  workersBySupplier: Record<string, PartnerWorkerChoice[]>;
  /** この現場に登録済みの作業員（自社の選択も含む）。 */
  registeredWorkerIds: string[];
  /** 追加できる協力会社（有効な協力会社で、まだこの現場に無いもの）。 */
  addable: { id: string; name: string }[];
  otherSites: SiteChoice[];
  overtimeHint: OvertimeHint;
}) {
  const registered = new Set(registeredWorkerIds);
  return (
    <div className="space-y-8">
      <section aria-labelledby="site-partners" className="space-y-3">
        <h2 id="site-partners" className={sectionHeadingClass}>
          この現場の協力会社（{partners.length}社）
        </h2>
        {partners.length === 0 ? (
          <EmptyText>この現場の協力会社はまだありません。{readOnly ? '' : '下の「協力会社を追加」から追加します。'}</EmptyText>
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
                overtimeHint={overtimeHint}
              />
            ))}
          </ul>
        )}
      </section>
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
  overtimeHint,
}: {
  siteId: string;
  partner: PartnerCardData;
  workers: PartnerWorkerChoice[];
  registered: Set<string>;
  readOnly: boolean;
  overtimeHint: OvertimeHint;
}) {
  const [editing, setEditing] = useState(false);
  const registeredIds = workers.filter((w) => registered.has(w.id)).map((w) => w.id);
  const registeredKey = registeredIds.join(',');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(registeredIds));
  // サーバーの登録が変わった（保存・ほかの現場からのコピー・新しい作業員の登録）ときは、チェックをサーバーの登録に
  // 合わせ直す。まだ保存していないチェックの付け外しは残す（新しい作業員を登録しても、付け外しの途中が消えない）。
  const [prevIds, setPrevIds] = useState(registeredIds);
  if (prevIds.join(',') !== registeredKey) {
    const before = new Set(prevIds);
    const now = new Set(registeredIds);
    setPrevIds(registeredIds);
    setChecked((prev) => {
      const next = new Set(registeredIds);
      for (const id of prev) if (!before.has(id) && !now.has(id)) next.add(id); // 保存前に付けた
      for (const id of before) if (!prev.has(id) && now.has(id)) next.delete(id); // 保存前に外した
      return next;
    });
  }
  const [adding, setAdding] = useState(false);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [savedWorkers, setSavedWorkers] = useState(false);
  const remover = useRunner();
  const workerRunner = useRunner();
  const name = partner.supplierName || '（不明な会社）';

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
    <li className="rounded-lg border-2 border-gray-300 p-3 dark:border-gray-700">
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
        <p className="mb-1 text-xs text-gray-600 dark:text-gray-400">無効の作業員は表示されません。登録を保存すると外れます。</p>
        {workers.length === 0 ? (
          <p className="py-2 text-sm text-gray-600 dark:text-gray-400">
            {readOnly
              ? 'この会社の有効な作業員がいません。'
              : 'この会社の有効な作業員がいません。下の「＋ 新しい作業員を登録」から登録できます。'}
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
        {addedName && !adding && (
          <p role="status" className="mt-2 text-sm font-medium text-green-700 dark:text-green-400">
            {addedName} を登録しました（この現場に登録済み）
          </p>
        )}
        {!readOnly &&
          (adding ? (
            <NewWorkerForm
              siteId={siteId}
              supplierId={partner.supplierId}
              companyName={name}
              overtimeHint={overtimeHint}
              onCancel={() => setAdding(false)}
              onDone={(workerName) => {
                setAdding(false);
                setSavedWorkers(false);
                setAddedName(workerName);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddedName(null);
                setSavedWorkers(false);
                setAdding(true);
              }}
              className={`${outlineBlueButtonClass} mt-3 w-full`}
            >
              ＋ 新しい作業員を登録
            </button>
          ))}
        {!readOnly && workers.length > 0 && (
          <div className="mt-3 space-y-2">
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

/**
 * 協力会社のカードから、その会社の作業員を新しく登録する小さなフォーム。作業員マスターに協力会社（この会社）として
 * 作られ、この現場に登録される（日当の適用開始日はサーバーが決める）。
 */
function NewWorkerForm({
  siteId,
  supplierId,
  companyName,
  overtimeHint,
  onCancel,
  onDone,
}: {
  siteId: string;
  supplierId: string;
  companyName: string;
  overtimeHint: OvertimeHint;
  onCancel: () => void;
  onDone: (workerName: string) => void;
}) {
  const { pending, error, setError, runResult } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      siteId,
      supplierId,
      name: str(fd, 'name'),
      trade: str(fd, 'trade'),
      // 日当は必須（空欄は数値でないので検証エラー）。残業単価の空欄は null（標準の計算式）。
      amount: parseYenInput(str(fd, 'amount')) ?? Number.NaN,
      overtimeRate: parseYenInput(str(fd, 'overtimeRate')),
    };
    const message = firstError(sitePartnerWorkerAddSchema, input);
    if (message) {
      setError(message);
      return;
    }
    const workerName = input.name.trim();
    runResult(
      async () => {
        const res = await addSitePartnerWorker(input);
        return res.ok ? { ok: true } : res;
      },
      () => onDone(workerName),
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border-2 border-blue-700 p-3 dark:border-blue-400">
      <p className="font-bold">新しい作業員を登録</p>
      <Field label="名前（必須）">
        <input name="name" maxLength={100} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="職種">
        <input name="trade" maxLength={500} placeholder="例: 鳶" className={inputClass} />
      </Field>
      <Field label="日当（円・必須）">
        <input name="amount" type="text" inputMode="numeric" placeholder="例: 20000" className={inputClass} />
      </Field>
      <div>
        <Field label="残業単価（円/H・任意）">
          <input name="overtimeRate" type="text" inputMode="numeric" className={inputClass} />
        </Field>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          空欄なら 日当 ÷ {overtimeHint.baseHours} × {overtimeHint.multiplier}
        </p>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        作業員マスターに{companyName}の作業員として登録され、この現場に登録されます。日当は管理者が後から直せます。
      </p>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} flex-1`}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} flex-1`}>
          {pending ? '登録中…' : '登録'}
        </button>
      </div>
    </form>
  );
}

function AmountForm({ partner, onDone }: { partner: PartnerCardData; onDone: () => void }) {
  const { pending, error, setError, runResult } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = parseYenInput(str(fd, 'amount'));
    const invalid = partnerAmountError(amount);
    if (invalid) {
      setError(invalid);
      return;
    }
    runResult(() => updateSitePartner({ id: partner.id, amount, note: str(fd, 'note') }), onDone);
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-3">
      <Field label="請負金額（円・任意）">
        <input name="amount" type="text" inputMode="numeric" defaultValue={partner.amount ?? ''} placeholder="例: 1500000" className={inputClass} />
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
      setError('協力会社を選んでください');
      return;
    }
    // すでにある会社は選択肢に出さない（追加し直すと請負金額・メモが上書きされるため）。
    if (!addable.some((s) => s.id === supplierId)) {
      setError('この協力会社はすでに追加されています');
      return;
    }
    const amount = parseYenInput(str(fd, 'amount'));
    const invalid = partnerAmountError(amount);
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
    <section aria-labelledby="add-partner" className={sectionCardClass}>
      <h2 id="add-partner" className={sectionHeadingClass}>
        協力会社を追加
      </h2>
      {addable.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          追加できる協力会社がありません。協力会社は管理者が マスター → 協力会社 で登録します。
        </p>
      ) : (
        <form key={formKey} onSubmit={submit} className="space-y-3">
          <Field label="協力会社">
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
            <input name="amount" type="text" inputMode="numeric" placeholder="例: 1500000" className={inputClass} />
          </Field>
          <Field label="メモ（任意）">
            <input name="note" maxLength={200} className={inputClass} />
          </Field>
          <ErrorText message={error} />
          <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
            {pending ? '追加中…' : '＋ 協力会社を追加'}
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
    <section aria-labelledby="copy-partners" className={sectionCardClass}>
      <h2 id="copy-partners" className={sectionHeadingClass}>
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
