'use client';

import { amount, productivity } from '@/lib/calc/report';
import type { WorkLine } from '@/lib/types';
import { decimal, money, newLine, patchRow, removeRow, row, type Row } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';

/** 作業内容（出来高）の表。歩掛 = 施工数量 ÷ 投入人工、合計金額 = 施工数量 × 施工単価。 */
export function WorkTable({
  rows,
  onChange,
  units,
}: {
  rows: Row<WorkLine>[];
  onChange: (update: (rows: Row<WorkLine>[]) => Row<WorkLine>[]) => void;
  units: string[];
}) {
  const set = (i: number, patch: Partial<WorkLine>) => onChange((rs) => patchRow(rs, i, patch));
  const unitOptions = units.map((u) => ({ value: u, label: u }));

  const columns: Column<WorkLine>[] = [
    { label: '工種', wide: true, cell: (l, i) => <TextInput value={l.trade} maxLength={200} onChange={(v) => set(i, { trade: v })} /> },
    { label: '施工内容', wide: true, cell: (l, i) => <TextInput value={l.description} maxLength={200} onChange={(v) => set(i, { description: v })} /> },
    { label: '施工数量', cell: (l, i) => <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v })} /> },
    { label: '投入人工', cell: (l, i) => <NumInput value={l.manDays} onChange={(v) => set(i, { manDays: v })} /> },
    { label: '施工単価', cell: (l, i) => <NumInput value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v })} /> },
    { label: '歩掛', input: false, cell: (l) => <Computed>{decimal(productivity(l.qty, l.manDays))}</Computed> },
    { label: '合計金額', input: false, cell: (l) => <Computed>{money(amount(l.qty, l.unitPrice))}</Computed> },
  ];

  return (
    <LineTable
      title="作業内容"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(7rem,1fr)_minmax(9rem,2fr)_6rem_5rem_5.5rem_6.5rem_4.5rem_6.5rem_4.5rem]"
      minWidthClass="md:min-w-[56rem]"
      onAdd={() => onChange((rs) => [...rs, row(newLine.work())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="出来高 小計"
      subtotal={money(rows.reduce((s, r) => s + amount(r.line.qty, r.line.unitPrice), 0))}
      emptyText="作業内容はまだありません。"
    />
  );
}
