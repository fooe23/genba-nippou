'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import { rateAt } from '@/lib/calc/rates';
import {
  affiliationLabel,
  canDeleteWorker,
  countInactive,
  filterWorkers,
  workerFilterOptions,
  type SupplierNames,
  type WorkerFilter,
} from '@/lib/calc/affiliation';
import { addWorkerRate, createWorkerWithRate, deleteWorker, upsertWorker } from '@/lib/db/masters-actions';
import type { Supplier, Worker } from '@/lib/db/masters';
import type { Affiliation, LaborRule } from '@/lib/types';
import { amountSchema, dateSchema, firstError, workerInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row, UpdatedText,
  inputClass, numOrNull, primaryButtonClass, str, updatedLabel, useRunner, type Updaters,
} from './common';
import { EditDialog } from './EditDialog';
import { RateHistoryEditor } from './RateHistoryEditor';

export function WorkersPanel({
  workers,
  suppliers,
  usedWorkerIds,
  today,
  rule,
  updaters,
}: {
  workers: Worker[];
  suppliers: Supplier[];
  /** 日報・繰越で使っている作業員の ID。null は読めなかった（削除ボタンを出さない）。 */
  usedWorkerIds: string[] | null;
  today: string;
  rule: LaborRule;
  updaters: Updaters;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [filter, setFilter] = useState<WorkerFilter>('all');
  const [showInactive, setShowInactive] = useState(false);
  // 保存後に最新の props から引き直すため、オブジェクトではなく id を保持する
  const editing = editingId && editingId !== 'new' ? (workers.find((w) => w.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);
  const supplierNames: SupplierNames = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const used = useMemo(() => (usedWorkerIds === null ? null : new Set(usedWorkerIds)), [usedWorkerIds]);
  const filterOptions = workerFilterOptions(workers, supplierNames);
  // 絞り込みの会社の作業員がいなくなった（削除・所属の変更）ときは「すべて」に戻す。
  const currentFilter = filterOptions.some((o) => o.value === filter) ? filter : 'all';
  const shown = filterWorkers(workers, currentFilter, showInactive);
  const inactiveCount = countInactive(workers, currentFilter);

  return (
    <div>
      <ListHeader title="作業員" onAdd={() => setEditingId('new')} />
      {workers.length === 0 ? (
        <EmptyText>作業員がまだ登録されていません。</EmptyText>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="block min-w-0 flex-1 sm:max-w-xs">
              <span className="mb-1 block text-sm font-medium">所属で絞り込み</span>
              <select value={currentFilter} onChange={(e) => setFilter(e.target.value)} className={inputClass}>
                {filterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="size-5 shrink-0"
              />
              無効も表示（{inactiveCount} 名）
            </label>
          </div>
          {shown.length === 0 ? (
            <EmptyText>条件に合う作業員はいません。</EmptyText>
          ) : (
            <ul>
              {shown.map((w) => {
                const rate = rateAt(w.rates, today);
                return (
                  <Row
                    key={w.id}
                    title={w.name}
                    sub={`${affiliationLabel(w.affiliation, w.supplierId, supplierNames)}／${w.trade ?? '職種未設定'}`}
                    meta={updatedLabel(w.updatedAt, w.updatedBy, updaters)}
                    dim={!w.active}
                    onClick={() => setEditingId(w.id)}
                    right={
                      <>
                        <span className="font-medium">{rate === null ? '未設定' : `${yen(rate)}/日`}</span>
                        {w.overtimeRate !== null && (
                          <span className="text-xs text-gray-600 dark:text-gray-400">残業 {yen(w.overtimeRate)}/H</span>
                        )}
                        <ActiveBadge active={w.active} />
                      </>
                    }
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
      <EditDialog open={editingId !== null} title={editing ? '作業員を編集' : '作業員を追加'} onClose={close}>
        <WorkerForm
          key={editingId ?? 'none'}
          worker={editing}
          suppliers={suppliers}
          // null（使用状況が読めない）は削除不可として扱う
          deletable={editing !== null && used !== null && canDeleteWorker(editing.id, used)}
          usageKnown={used !== null}
          rule={rule}
          updaters={updaters}
          onDone={close}
        />
      </EditDialog>
    </div>
  );
}

function WorkerForm({
  worker,
  suppliers,
  deletable,
  usageKnown,
  rule,
  updaters,
  onDone,
}: {
  worker: Worker | null;
  suppliers: Supplier[];
  /** 日報・繰越で一度も使っていない（削除できる）。 */
  deletable: boolean;
  /** 使用状況を読めたか（読めなければ削除の案内を出さない）。 */
  usageKnown: boolean;
  rule: LaborRule;
  updaters: Updaters;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();
  // 削除は結果の文言をボタンのそばに出すため、保存とは別に持つ。
  const remover = useRunner();
  const [affiliation, setAffiliation] = useState<Affiliation>(worker?.affiliation ?? 'own');
  // 取引先の選択肢：有効な取引先＋いま選んでいる取引先（無効になっていても消さない）。
  const supplierChoices = suppliers.filter((s) => s.active || s.id === worker?.supplierId);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      id: worker?.id,
      name: str(fd, 'name'),
      trade: str(fd, 'trade'),
      note: str(fd, 'note'),
      // 空欄は null（標準の計算式）。数値にできない入力は NaN で検証エラーにする。
      overtimeRate: numOrNull(str(fd, 'overtimeRate')),
      affiliation,
      supplierId: affiliation === 'partner' ? str(fd, 'supplierId') || null : null,
    };
    const rateRaw = str(fd, 'rateAmount').trim();
    const rateDate = str(fd, 'rateDate');
    const rateAmount = Number(rateRaw);
    const message =
      firstError(workerInputSchema, input) ??
      (!worker && rateRaw !== '' ? (firstError(amountSchema, rateAmount) ?? firstError(dateSchema, rateDate)) : null);
    if (message) {
      setError(message);
      return;
    }
    run(async () => {
      // 新規＋初回単価は1アクション（途中失敗は巻き戻され、成功後はダイアログを閉じるので重複しない）
      if (!worker && rateRaw !== '') {
        await createWorkerWithRate({ ...input, amount: rateAmount, effectiveFrom: rateDate });
      } else {
        await upsertWorker(input);
      }
    }, onDone);
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名前（必須）">
          <input name="name" defaultValue={worker?.name ?? ''} maxLength={100} className={inputClass} />
        </Field>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium">所属</legend>
          <div className="flex gap-2">
            {(['own', 'partner'] as const).map((a) => (
              <label
                key={a}
                className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-400 px-3 has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50 has-[:checked]:font-bold dark:border-gray-600 dark:has-[:checked]:border-blue-400 dark:has-[:checked]:bg-blue-950"
              >
                <input
                  type="radio"
                  name="affiliation"
                  value={a}
                  checked={affiliation === a}
                  onChange={() => setAffiliation(a)}
                  className="size-5"
                />
                {a === 'own' ? '自社' : '協力会社'}
              </label>
            ))}
          </div>
        </fieldset>
        {affiliation === 'partner' && (
          <div>
            <Field label="協力会社（必須）">
              <select name="supplierId" defaultValue={worker?.supplierId ?? ''} className={inputClass}>
                <option value="">取引先から選んでください</option>
                {supplierChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.active ? s.name : `${s.name}（無効）`}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              協力会社は 取引先 タブで登録します。協力会社の作業員は、現場の「協力会社と作業員」で現場ごとに登録すると日報で選べます。
            </p>
          </div>
        )}
        <Field label="職種">
          <input name="trade" defaultValue={worker?.trade ?? ''} className={inputClass} placeholder="例: 大工" />
        </Field>
        <Field label="メモ">
          <input name="note" defaultValue={worker?.note ?? ''} className={inputClass} />
        </Field>
        <div>
          <Field label="残業単価（円/H・任意）">
            <input
              name="overtimeRate"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              defaultValue={worker?.overtimeRate ?? ''}
              className={inputClass}
            />
          </Field>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">空欄なら 日当 ÷ {rule.overtimeBaseHours} × {rule.overtimeMultiplier}（設定で変更可）</p>
        </div>
        {!worker && (
          <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
            <p className="text-sm font-bold">最初の日当（任意）</p>
            <Field label="適用開始日">
              <input name="rateDate" type="date" defaultValue="" className={inputClass} />
            </Field>
            <Field label="日当（円）">
              <input name="rateAmount" type="number" inputMode="decimal" min={0} className={inputClass} />
            </Field>
          </div>
        )}
        <ErrorText message={error} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
      {worker && (
        <>
          <RateHistoryEditor
            rates={worker.rates}
            amountLabel="日当"
            updaters={updaters}
            onAdd={(amount, from) => addWorkerRate(worker.id, amount, from)}
          />
          <ActiveToggle
            active={worker.active}
            pending={pending}
            onToggle={() =>
              run(async () => {
                await upsertWorker({ id: worker.id, name: worker.name, active: !worker.active });
              }, onDone)
            }
          />
          {deletable ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={pending || remover.pending}
                onClick={() => {
                  if (window.confirm(`${worker.name} を削除します。元に戻せません。よろしいですか？`)) {
                    remover.runResult(() => deleteWorker(worker.id), onDone);
                  }
                }}
                className="min-h-11 w-full rounded-lg border border-red-600 bg-red-50 px-4 text-base font-bold text-red-700 disabled:opacity-50 dark:border-red-500 dark:bg-red-950 dark:text-red-300"
              >
                {remover.pending ? '削除中…' : '削除'}
              </button>
              <ErrorText message={remover.error} />
            </div>
          ) : usageKnown ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">使用中のため削除できません。使わなくなったら無効にしてください。</p>
          ) : null}
          <UpdatedText updatedAt={worker.updatedAt} updatedBy={worker.updatedBy} updaters={updaters} />
        </>
      )}
    </>
  );
}
