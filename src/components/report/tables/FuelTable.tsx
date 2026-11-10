'use client';

import { fuelCost } from '@/lib/calc/report';
import type { FuelLine } from '@/lib/types';
import { decimal, money, newLine, patchRow, removeRow, row, type Row, type VehicleOption } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import type { IssueOption } from '@/lib/report/issue-options';
import { ExtraField, IssuePicker } from './IssuePicker';

/** 車両の表。燃費は車両マスターから複写する。燃料費 = 走行距離 ÷ 燃費 × 燃料単価。 */
export function FuelTable({
  rows,
  onChange,
  issueChoices,
  vehicles,
}: {
  rows: Row<FuelLine>[];
  onChange: (update: (rows: Row<FuelLine>[]) => Row<FuelLine>[]) => void;
  /** 根拠の件の選択肢（issueOptions）。 */
  issueChoices: IssueOption[];
  vehicles: VehicleOption[];
}) {
  const set = (i: number, patch: Partial<FuelLine>) => onChange((rs) => patchRow(rs, i, patch));
  const options = vehicles.map((v) => ({ value: v.id, label: v.active ? v.name : `${v.name}（無効）` }));
  const cost = (l: FuelLine) => fuelCost(l.distanceKm, l.kmPerL, l.pricePerL);

  const columns: Column<FuelLine>[] = [
    {
      label: '車両',
      wide: true,
      cell: (l, i) => (
        <Select
          value={l.vehicleId ?? ''}
          options={options}
          missingLabel={l.vehicleName || '（不明な車両）'}
          onChange={(id) => {
            const v = vehicles.find((x) => x.id === id);
            if (!v) set(i, { vehicleId: null, vehicleName: '', kmPerL: null });
            else set(i, { vehicleId: v.id, vehicleName: v.name, kmPerL: v.kmPerL });
          }}
        />
      ),
    },
    { label: '走行距離（km）', cell: (l, i) => <NumInput value={l.distanceKm} onChange={(v) => set(i, { distanceKm: v })} /> },
    { label: '燃費（km/L）', input: false, cell: (l) => <Computed>{l.kmPerL ? decimal(l.kmPerL) : '未設定'}</Computed> },
    { label: '燃料単価（円/L）', cell: (l, i) => <NumInput value={l.pricePerL} onChange={(v) => set(i, { pricePerL: v })} /> },
    { label: '備考', wide: true, cell: (l, i) => <TextInput value={l.note} maxLength={200} onChange={(v) => set(i, { note: v })} /> },
    { label: '燃料費', input: false, cell: (l) => <Computed>{money(cost(l))}</Computed> },
  ];

  return (
    <LineTable
      title="車両"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(9rem,2fr)_7rem_5.5rem_7rem_minmax(6rem,2fr)_6rem_4.5rem]"
      minWidthClass="md:min-w-[48rem]"
      onAdd={() => onChange((rs) => [...rs, row(newLine.fuel())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="燃料費 小計"
      subtotal={money(rows.reduce((s, r) => s + cost(r.line), 0))}
      emptyText="車両はまだありません。"
      rowExtra={(l, i) => (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <ExtraField label="根拠（件）">
            <IssuePicker value={l.issueId} options={issueChoices} onChange={(id) => set(i, { issueId: id })} />
          </ExtraField>
        </div>
      )}
    />
  );
}
