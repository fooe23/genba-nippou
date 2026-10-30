'use client';

import { useState, type FormEvent } from 'react';
import { upsertVehicle } from '@/lib/db/masters-actions';
import type { Vehicle } from '@/lib/db/masters';
import { firstError, vehicleInputSchema } from '@/lib/db/masters-schemas';
import {
  ActiveBadge, ActiveToggle, EmptyText, ErrorText, Field, ListHeader, Row,
  inputClass, numOrNull, primaryButtonClass, str, useRunner,
} from './common';
import { EditDialog } from './EditDialog';

export function VehiclesPanel({ vehicles }: { vehicles: Vehicle[] }) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const editing = editingId && editingId !== 'new' ? (vehicles.find((v) => v.id === editingId) ?? null) : null;
  const close = () => setEditingId(null);

  return (
    <div>
      <ListHeader title="車両" onAdd={() => setEditingId('new')} />
      {vehicles.length === 0 ? (
        <EmptyText>車両がまだ登録されていません。</EmptyText>
      ) : (
        <ul>
          {vehicles.map((v) => (
            <Row
              key={v.id}
              title={v.name}
              sub={v.kind ?? '区分未設定'}
              dim={!v.active}
              onClick={() => setEditingId(v.id)}
              right={
                <>
                  <span className="font-medium">{v.kmPerL === null ? '燃費 未設定' : `${v.kmPerL} km/ℓ`}</span>
                  <ActiveBadge active={v.active} />
                </>
              }
            />
          ))}
        </ul>
      )}
      <EditDialog open={editingId !== null} title={editing ? '車両を編集' : '車両を追加'} onClose={close}>
        <VehicleForm key={editingId ?? 'none'} vehicle={editing} onDone={close} />
      </EditDialog>
    </div>
  );
}

function VehicleForm({ vehicle, onDone }: { vehicle: Vehicle | null; onDone: () => void }) {
  const { pending, error, setError, run } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      id: vehicle?.id,
      name: str(fd, 'name'),
      kind: str(fd, 'kind'),
      kmPerL: numOrNull(str(fd, 'kmPerL')),
      note: str(fd, 'note'),
    };
    const message = firstError(vehicleInputSchema, input);
    if (message) {
      setError(message);
      return;
    }
    run(async () => {
      await upsertVehicle(input);
    }, onDone);
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <Field label="車両名（必須）">
          <input name="name" defaultValue={vehicle?.name ?? ''} maxLength={100} className={inputClass} />
        </Field>
        <Field label="区分">
          <input name="kind" defaultValue={vehicle?.kind ?? ''} className={inputClass} placeholder="例: ワゴン" />
        </Field>
        <Field label="燃費（km/ℓ）">
          <input
            name="kmPerL"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={vehicle?.kmPerL ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="メモ">
          <input name="note" defaultValue={vehicle?.note ?? ''} className={inputClass} />
        </Field>
        <ErrorText message={error} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
      {vehicle && (
        <ActiveToggle
          active={vehicle.active}
          pending={pending}
          onToggle={() =>
            run(async () => {
              await upsertVehicle({ id: vehicle.id, name: vehicle.name, active: !vehicle.active });
            }, onDone)
          }
        />
      )}
    </>
  );
}
