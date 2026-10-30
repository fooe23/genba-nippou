'use client';

import { useState, type FormEvent } from 'react';
import { upsertSupplier } from '@/lib/db/masters-actions';
import type { Supplier } from '@/lib/db/masters';
import { firstError, supplierInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row,
  inputClass, primaryButtonClass, str, useRunner,
} from './common';
import { EditDialog } from './EditDialog';

export function SuppliersPanel({ suppliers }: { suppliers: Supplier[] }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const editing = editingId && editingId !== 'new' ? (suppliers.find((s) => s.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);

  return (
    <div>
      <ListHeader title="取引先" onAdd={() => setEditingId('new')} />
      {suppliers.length === 0 ? (
        <EmptyText>取引先がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {suppliers.map((s) => (
            <Row
              key={s.id}
              title={s.name}
              sub={s.category ?? '区分未設定'}
              dim={!s.active}
              onClick={() => setEditingId(s.id)}
              right={<ActiveBadge active={s.active} />}
            />
          ))}
        </ul>
      )}
      <EditDialog open={editingId !== null} title={editing ? '取引先を編集' : '取引先を追加'} onClose={close}>
        <SupplierForm key={editingId ?? 'none'} supplier={editing} onDone={close} />
      </EditDialog>
    </div>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const { pending, error, setError, run } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      id: supplier?.id,
      name: str(fd, 'name'),
      category: str(fd, 'category'),
      contact: str(fd, 'contact'),
      note: str(fd, 'note'),
    };
    const message = firstError(supplierInputSchema, input);
    if (message) {
      setError(message);
      return;
    }
    run(async () => {
      await upsertSupplier(input);
    }, onDone);
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <Field label="取引先名（必須）">
          <input name="name" defaultValue={supplier?.name ?? ''} maxLength={100} className={inputClass} />
        </Field>
        <Field label="区分">
          <input name="category" defaultValue={supplier?.category ?? ''} className={inputClass} placeholder="例: 建材店" />
        </Field>
        <Field label="連絡先">
          <input name="contact" defaultValue={supplier?.contact ?? ''} className={inputClass} />
        </Field>
        <Field label="メモ">
          <input name="note" defaultValue={supplier?.note ?? ''} className={inputClass} />
        </Field>
        <ErrorText message={error} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
      {supplier && (
        <ActiveToggle
          active={supplier.active}
          pending={pending}
          onToggle={() =>
            run(async () => {
              await upsertSupplier({ id: supplier.id, name: supplier.name, active: !supplier.active });
            }, onDone)
          }
        />
      )}
    </>
  );
}
