'use client';

import { useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import { rateAt } from '@/lib/calc/rates';
import { addLeaseItemRate, createLeaseItemWithRate, upsertLeaseItem } from '@/lib/db/masters-actions';
import type { LeaseItem } from '@/lib/db/masters';
import { amountSchema, dateSchema, firstError, leaseItemInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row, UpdatedText,
  inputClass, primaryButtonClass, str, updatedLabel, useRunner, type Updaters,
} from './common';
import { EditDialog } from './EditDialog';
import { RateHistoryEditor } from './RateHistoryEditor';

export function LeaseItemsPanel({ items, today, updaters }: { items: LeaseItem[]; today: string; updaters: Updaters }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const editing = editingId && editingId !== 'new' ? (items.find((i) => i.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);

  return (
    <div>
      <ListHeader title="リース品" onAdd={() => setEditingId('new')} />
      {items.length === 0 ? (
        <EmptyText>リース品がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {items.map((i) => {
            const rate = rateAt(i.rates, today);
            return (
              <Row
                key={i.id}
                title={i.name}
                sub={i.spec ?? '規格未設定'}
                meta={updatedLabel(i.updatedAt, i.updatedBy, updaters)}
                dim={!i.active}
                onClick={() => setEditingId(i.id)}
                right={
                  <>
                    <span className="font-medium">{rate === null ? '未設定' : yen(rate)}</span>
                    <ActiveBadge active={i.active} />
                  </>
                }
              />
            );
          })}
        </ul>
      )}
      <EditDialog open={editingId !== null} title={editing ? 'リース品を編集' : 'リース品を追加'} onClose={close}>
        <LeaseItemForm key={editingId ?? 'none'} item={editing} updaters={updaters} onDone={close} />
      </EditDialog>
    </div>
  );
}

function LeaseItemForm({ item, updaters, onDone }: { item: LeaseItem | null; updaters: Updaters; onDone: () => void }) {
  const { pending, error, setError, run } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = { id: item?.id, name: str(fd, 'name'), spec: str(fd, 'spec'), note: str(fd, 'note') };
    const rateRaw = str(fd, 'rateAmount').trim();
    const rateDate = str(fd, 'rateDate');
    const rateAmount = Number(rateRaw);
    const message =
      firstError(leaseItemInputSchema, input) ??
      (!item && rateRaw !== '' ? (firstError(amountSchema, rateAmount) ?? firstError(dateSchema, rateDate)) : null);
    if (message) {
      setError(message);
      return;
    }
    run(async () => {
      if (!item && rateRaw !== '') {
        await createLeaseItemWithRate({ ...input, amount: rateAmount, effectiveFrom: rateDate });
      } else {
        await upsertLeaseItem(input);
      }
    }, onDone);
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <Field label="品名（必須）">
          <input name="name" defaultValue={item?.name ?? ''} maxLength={100} className={inputClass} />
        </Field>
        <Field label="規格">
          <input name="spec" defaultValue={item?.spec ?? ''} className={inputClass} />
        </Field>
        <Field label="メモ">
          <input name="note" defaultValue={item?.note ?? ''} className={inputClass} />
        </Field>
        {!item && (
          <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
            <p className="text-sm font-bold">最初の単価（任意）</p>
            <Field label="適用開始日">
              <input name="rateDate" type="date" defaultValue="" className={inputClass} />
            </Field>
            <Field label="単価（円）">
              <input name="rateAmount" type="number" inputMode="decimal" min={0} className={inputClass} />
            </Field>
          </div>
        )}
        <ErrorText message={error} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
      {item && (
        <>
          <RateHistoryEditor
            rates={item.rates}
            amountLabel="単価"
            updaters={updaters}
            onAdd={(amount, from) => addLeaseItemRate(item.id, amount, from)}
          />
          <ActiveToggle
            active={item.active}
            pending={pending}
            onToggle={() =>
              run(async () => {
                await upsertLeaseItem({ id: item.id, name: item.name, active: !item.active });
              }, onDone)
            }
          />
          <UpdatedText updatedAt={item.updatedAt} updatedBy={item.updatedBy} updaters={updaters} />
        </>
      )}
    </>
  );
}
