'use client';

import { useState, type FormEvent } from 'react';
import { upsertSupplier } from '@/lib/db/masters-actions';
import type { Supplier } from '@/lib/db/masters';
import { firstError, supplierInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row, UpdatedText,
  inputClass, primaryButtonClass, str, updatedLabel, useRunner, type Updaters,
} from './common';
import { EditDialog } from './EditDialog';

/** vendor：取引先（買掛の相手先）のタブ。partner：協力会社（作業員の所属）のタブ。同じ gn_suppliers を印で分けて出す。 */
export type SupplierPanelMode = 'vendor' | 'partner';

const LABEL: Record<SupplierPanelMode, string> = { vendor: '取引先', partner: '協力会社' };

/** 一覧の副題：区分と、もう一方の印も付いていればその旨。 */
function supplierSub(s: Supplier, mode: SupplierPanelMode): string {
  const category = s.category ?? '区分未設定';
  const both = s.isVendor && s.isPartner;
  return both ? `${category}／${mode === 'vendor' ? '協力会社にも登録' : '取引先にも登録'}` : category;
}

export function SuppliersPanel({ suppliers, updaters, mode = 'vendor' }: { suppliers: Supplier[]; updaters: Updaters; mode?: SupplierPanelMode }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const label = LABEL[mode];
  const shown = suppliers.filter((s) => (mode === 'vendor' ? s.isVendor : s.isPartner));
  // 編集中の会社は、印を外して一覧から消えても閉じるまで探せるよう全体から探す。
  const editing = editingId && editingId !== 'new' ? (suppliers.find((s) => s.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);

  return (
    <div>
      <ListHeader title={label} onAdd={() => setEditingId('new')} />
      {mode === 'partner' && (
        <p className="mb-3 rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          作業員は 作業員 タブで所属を「協力会社」にして登録します。社員は現場の「協力会社と作業員」から、その現場に入っている協力会社の作業員を新しく登録できます。
        </p>
      )}
      {shown.length === 0 ? (
        <EmptyText>{label}がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {shown.map((s) => (
            <Row
              key={s.id}
              title={s.name}
              sub={supplierSub(s, mode)}
              meta={updatedLabel(s.updatedAt, s.updatedBy, updaters)}
              dim={!s.active}
              onClick={() => setEditingId(s.id)}
              right={<ActiveBadge active={s.active} />}
            />
          ))}
        </ul>
      )}
      <EditDialog open={editingId !== null} title={editing ? `${label}を編集` : `${label}を追加`} onClose={close}>
        <SupplierForm key={editingId ?? 'none'} supplier={editing} mode={mode} updaters={updaters} onDone={close} />
      </EditDialog>
    </div>
  );
}

function SupplierForm({
  supplier,
  mode,
  updaters,
  onDone,
}: {
  supplier: Supplier | null;
  mode: SupplierPanelMode;
  updaters: Updaters;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();
  // 新しく作るときは開いたタブの印だけを付ける（協力会社のタブから作った会社は買掛の選択肢に出さない）。
  const [isVendor, setIsVendor] = useState(supplier ? supplier.isVendor : mode === 'vendor');
  const [isPartner, setIsPartner] = useState(supplier ? supplier.isPartner : mode === 'partner');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      id: supplier?.id,
      name: str(fd, 'name'),
      category: str(fd, 'category'),
      contact: str(fd, 'contact'),
      note: str(fd, 'note'),
      isVendor,
      isPartner,
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
        <Field label={`${LABEL[mode]}名（必須）`}>
          <input name="name" defaultValue={supplier?.name ?? ''} maxLength={100} className={inputClass} />
        </Field>
        <Field label="区分">
          <input name="category" defaultValue={supplier?.category ?? ''} className={inputClass} placeholder={mode === 'partner' ? '例: 内装工事' : '例: 建材店'} />
        </Field>
        <Field label="連絡先">
          <input name="contact" defaultValue={supplier?.contact ?? ''} className={inputClass} />
        </Field>
        <Field label="メモ">
          <input name="note" defaultValue={supplier?.note ?? ''} className={inputClass} />
        </Field>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium">種類（どちらか、または両方）</legend>
          <div className="space-y-2">
            <RoleCheckbox label="取引先（買掛の相手先）" checked={isVendor} onChange={setIsVendor} />
            <RoleCheckbox label="協力会社（作業員の所属）" checked={isPartner} onChange={setIsPartner} />
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            外注の作業員は買掛にしません。人が来て働く会社は協力会社にしてください
          </p>
        </fieldset>
        <ErrorText message={error} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
      {supplier && (
        <>
          <ActiveToggle
            active={supplier.active}
            pending={pending}
            onToggle={() =>
              run(async () => {
                await upsertSupplier({ id: supplier.id, name: supplier.name, active: !supplier.active });
              }, onDone)
            }
          />
          <UpdatedText updatedAt={supplier.updatedAt} updatedBy={supplier.updatedBy} updaters={updaters} />
        </>
      )}
    </>
  );
}

function RoleCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-gray-400 px-3 has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50 has-[:checked]:font-bold dark:border-gray-600 dark:has-[:checked]:border-blue-400 dark:has-[:checked]:bg-blue-950">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 shrink-0" />
      {label}
    </label>
  );
}
