'use client';

import { useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import { rateAt } from '@/lib/calc/rates';
import { addWorkerRate, createWorkerWithRate, upsertWorker } from '@/lib/db/masters-actions';
import type { Worker } from '@/lib/db/masters';
import { amountSchema, dateSchema, firstError, workerInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row,
  inputClass, numOrNull, primaryButtonClass, str, useRunner,
} from './common';
import { EditDialog } from './EditDialog';
import { RateHistoryEditor } from './RateHistoryEditor';

export function WorkersPanel({ workers, today }: { workers: Worker[]; today: string }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  // 保存後に最新の props から引き直すため、オブジェクトではなく id を保持する
  const editing = editingId && editingId !== 'new' ? (workers.find((w) => w.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);

  return (
    <div>
      <ListHeader title="作業員" onAdd={() => setEditingId('new')} />
      {workers.length === 0 ? (
        <EmptyText>作業員がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {workers.map((w) => {
            const rate = rateAt(w.rates, today);
            return (
              <Row
                key={w.id}
                title={w.name}
                sub={w.trade ?? '職種未設定'}
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
      <EditDialog open={editingId !== null} title={editing ? '作業員を編集' : '作業員を追加'} onClose={close}>
        <WorkerForm key={editingId ?? 'none'} worker={editing} onDone={close} />
      </EditDialog>
    </div>
  );
}

function WorkerForm({ worker, onDone }: { worker: Worker | null; onDone: () => void }) {
  const { pending, error, setError, run } = useRunner();

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
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">空欄なら 日当 ÷ 8 × 1.25（設定で変更可）</p>
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
        </>
      )}
    </>
  );
}
