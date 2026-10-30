'use client';

import { useState, type FormEvent } from 'react';
import type { MasterOption } from '@/lib/db/masters';
import { firstError, optionInputSchema } from '@/lib/db/masters-schemas';
import {
  EmptyText, ErrorText, Field, ListHeader, Row,
  inputClass, primaryButtonClass, str, useRunner,
} from './common';
import { EditDialog } from './EditDialog';

/** 単位・天候の選択肢（名前＋並び順）。名前は一意で、既存の名前は並び順だけ変更できる。 */
export function OptionsPanel({
  title,
  options,
  onSave,
}: {
  title: string;
  options: MasterOption[];
  onSave: (name: string, sortOrder: number) => Promise<void>;
}) {
  const [editingName, setEditingName] = useState<string | 'new' | null>(null);
  const editing = editingName && editingName !== 'new' ? (options.find((o) => o.name === editingName) ?? null) : null;
  const close = () => setEditingName(null);
  const nextOrder = options.reduce((max, o) => Math.max(max, o.sortOrder), 0) + 1;

  return (
    <div>
      <ListHeader title={title} onAdd={() => setEditingName('new')} />
      {options.length === 0 ? (
        <EmptyText>{title}がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {options.map((o) => (
            <Row
              key={o.name}
              title={o.name}
              onClick={() => setEditingName(o.name)}
              right={<span className="text-gray-600 dark:text-gray-400">並び順 {o.sortOrder}</span>}
            />
          ))}
        </ul>
      )}
      <EditDialog open={editingName !== null} title={editing ? `${title}を編集` : `${title}を追加`} onClose={close}>
        <OptionForm key={editingName ?? 'none'} option={editing} defaultOrder={nextOrder} onSave={onSave} onDone={close} />
      </EditDialog>
    </div>
  );
}

function OptionForm({
  option,
  defaultOrder,
  onSave,
  onDone,
}: {
  option: MasterOption | null;
  defaultOrder: number;
  onSave: (name: string, sortOrder: number) => Promise<void>;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = str(fd, 'sortOrder').trim();
    const input = { name: option?.name ?? str(fd, 'name'), sortOrder: raw === '' ? NaN : Number(raw) };
    const message = firstError(optionInputSchema, input);
    if (message) {
      setError(message);
      return;
    }
    run(() => onSave(input.name, input.sortOrder), onDone);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="名前（必須）">
        {option ? (
          <p className="flex min-h-11 items-center px-1 text-base font-bold">{option.name}</p>
        ) : (
          <input name="name" maxLength={100} className={inputClass} />
        )}
      </Field>
      <Field label="並び順（小さいほど上）">
        <input
          name="sortOrder"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={option?.sortOrder ?? defaultOrder}
          className={inputClass}
        />
      </Field>
      {option && (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          名前は変更できません。別の名前にしたい場合は新しく追加してください。
        </p>
      )}
      <ErrorText message={error} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        {pending ? '保存中…' : '保存'}
      </button>
    </form>
  );
}
