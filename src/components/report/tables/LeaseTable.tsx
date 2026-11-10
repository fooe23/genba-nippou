'use client';

import { rateAt } from '@/lib/calc/rates';
import { amount } from '@/lib/calc/report';
import type { LeaseLine } from '@/lib/types';
import { money, newLine, patchRow, removeRow, row, type LeaseItemOption, type Row } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import type { IssueOption } from '@/lib/report/issue-options';
import { ExtraField, IssuePicker } from './IssuePicker';

/** リースの表。規格と単価（日報の日付時点）を品目マスターから複写する。規格は書き換えられる。 */
export function LeaseTable({
  rows,
  onChange,
  issueChoices,
  date,
  items,
  units,
}: {
  rows: Row<LeaseLine>[];
  onChange: (update: (rows: Row<LeaseLine>[]) => Row<LeaseLine>[]) => void;
  /** 根拠の件の選択肢（issueOptions）。 */
  issueChoices: IssueOption[];
  date: string;
  items: LeaseItemOption[];
  units: string[];
}) {
  const set = (i: number, patch: Partial<LeaseLine>) => onChange((rs) => patchRow(rs, i, patch));
  const options = items.map((x) => ({ value: x.id, label: x.active ? x.name : `${x.name}（無効）` }));
  const unitOptions = units.map((u) => ({ value: u, label: u }));

  const columns: Column<LeaseLine>[] = [
    {
      label: '品目',
      wide: true,
      cell: (l, i) => (
        <Select
          value={l.itemId ?? ''}
          options={options}
          missingLabel={l.itemName || '（不明な品目）'}
          onChange={(id) => {
            const item = items.find((x) => x.id === id);
            if (!item) set(i, { itemId: null, itemName: '', spec: '', unitPrice: null });
            else set(i, { itemId: item.id, itemName: item.name, spec: item.spec ?? '', unitPrice: rateAt(item.rates, date) });
          }}
        />
      ),
    },
    { label: '規格', wide: true, cell: (l, i) => <TextInput value={l.spec} maxLength={200} onChange={(v) => set(i, { spec: v })} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v })} /> },
    { label: '数量', cell: (l, i) => <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} /> },
    { label: '単価', input: false, cell: (l) => <Computed>{l.unitPrice === null ? '未設定' : money(l.unitPrice)}</Computed> },
    { label: '備考', wide: true, cell: (l, i) => <TextInput value={l.note} maxLength={200} onChange={(v) => set(i, { note: v })} /> },
    { label: 'リース費', input: false, cell: (l) => <Computed>{money(amount(l.qty, l.unitPrice))}</Computed> },
  ];

  return (
    <LineTable
      title="リース"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(8rem,1.5fr)_minmax(6rem,1fr)_5rem_5rem_6rem_minmax(6rem,1fr)_6rem_4.5rem]"
      minWidthClass="md:min-w-[52rem]"
      onAdd={() => onChange((rs) => [...rs, row(newLine.lease())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="リース費 小計"
      subtotal={money(rows.reduce((s, r) => s + amount(r.line.qty, r.line.unitPrice), 0))}
      emptyText="リース品はまだありません。"
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
