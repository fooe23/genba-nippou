'use client';

import { fuelCost } from '@/lib/calc/report';
import type { FuelLine } from '@/lib/types';
import { decimal, isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type Row, type VehicleOption } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import type { IssueOption } from '@/lib/report/issue-options';
import { ExtraField, IssuePicker } from './IssuePicker';

/** 車両の選択肢の末尾に置く「（手入力）」の値（車両の ID は uuid なので重ならない）。 */
const MANUAL_VEHICLE = '__manual__';

/**
 * 車両の表。燃費は車両マスターから複写する。燃料費 = 走行距離 ÷ 燃費 × 燃料単価。
 * マスターに無い車両は「（手入力）」で車両名と燃費を入れる（2026-11-18。参照なしの行。燃料単価はもともと毎回入れる）。
 */
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
  // 車両の選び直しと手入力の車両名：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<FuelLine>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const isManual = (r: Row<FuelLine>) => isManualRow(r, r.line.vehicleId, r.line.vehicleName);
  const options = [
    ...vehicles.map((v) => ({ value: v.id, label: v.active ? v.name : `${v.name}（無効）` })),
    { value: MANUAL_VEHICLE, label: '（手入力）' },
  ];
  const cost = (l: FuelLine) => fuelCost(l.distanceKm, l.kmPerL, l.pricePerL);

  const columns: Column<FuelLine>[] = [
    {
      label: '車両',
      wide: true,
      // 手入力の行は選択と車両名の 2 つの欄になるので、それぞれに label を付ける。
      input: false,
      cell: (l, i, r) => {
        const manual = isManual(r);
        return (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">車両（{i + 1}行目）</span>
              <Select
                value={l.vehicleId ?? (manual ? MANUAL_VEHICLE : '')}
                options={options}
                missingLabel={l.vehicleName || '（不明な車両）'}
                onChange={(id) => {
                  const v = vehicles.find((x) => x.id === id);
                  if (!v) select(i, { vehicleId: null, vehicleName: '', kmPerL: null }, id === MANUAL_VEHICLE);
                  else select(i, { vehicleId: v.id, vehicleName: v.name, kmPerL: v.kmPerL }, false);
                }}
              />
            </label>
            {manual && (
              <label className="block">
                <span className="sr-only">車両名（{i + 1}行目）</span>
                <TextInput value={l.vehicleName} maxLength={100} placeholder="車両名" onChange={(v) => select(i, { vehicleName: v }, true)} />
              </label>
            )}
          </div>
        );
      },
    },
    { label: '走行距離（km）', cell: (l, i) => <NumInput value={l.distanceKm} onChange={(v) => set(i, { distanceKm: v })} /> },
    {
      label: '燃費（km/L）',
      input: false,
      cell: (l, i, r) =>
        isManual(r) ? (
          <label className="block">
            <span className="sr-only">燃費（km/L・{i + 1}行目）</span>
            <NumInput value={l.kmPerL} placeholder="km/L" onChange={(v) => set(i, { kmPerL: v })} />
          </label>
        ) : (
          <Computed>{l.kmPerL ? decimal(l.kmPerL) : '未設定'}</Computed>
        ),
    },
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
      hint="車両がプルダウンに無いときは「（手入力）」を選んで車両名と燃費（km/L）を入れます。よく使う車両は、管理者にマスターへの登録を頼んでください。"
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
