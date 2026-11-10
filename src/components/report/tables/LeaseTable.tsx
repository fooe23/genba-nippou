'use client';

import { rateAt } from '@/lib/calc/rates';
import { amount } from '@/lib/calc/report';
import type { LeaseLine } from '@/lib/types';
import { isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type LeaseItemOption, type Row } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import type { IssueOption } from '@/lib/report/issue-options';
import { ExtraField, IssuePicker, TaggedCostNote } from './IssuePicker';

/** 品目の選択肢の末尾に置く「（手入力）」の値（品目の ID は uuid なので重ならない）。 */
const MANUAL_ITEM = '__manual__';

/**
 * リースの表。規格と単価（日報の日付時点）を品目マスターから複写する。規格は書き換えられる。
 * マスターに無い品目は「（手入力）」で品目名と単価を入れる（2026-11-18。参照なしの行。保存時もサーバーは単価を変えない）。
 */
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
  // 品目の選び直しと手入力の品目名：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<LeaseLine>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const isManual = (r: Row<LeaseLine>) => isManualRow(r, r.line.itemId, r.line.itemName);
  const options = [
    ...items.map((x) => ({ value: x.id, label: x.active ? x.name : `${x.name}（無効）` })),
    { value: MANUAL_ITEM, label: '（手入力）' },
  ];
  const unitOptions = units.map((u) => ({ value: u, label: u }));

  const columns: Column<LeaseLine>[] = [
    {
      label: '品目',
      wide: true,
      // 手入力の行は選択と品目名の 2 つの欄になるので、それぞれに label を付ける。
      input: false,
      cell: (l, i, r) => {
        const manual = isManual(r);
        return (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">品目（{i + 1}行目）</span>
              <Select
                value={l.itemId ?? (manual ? MANUAL_ITEM : '')}
                options={options}
                missingLabel={l.itemName || '（不明な品目）'}
                onChange={(id) => {
                  const item = items.find((x) => x.id === id);
                  if (!item) select(i, { itemId: null, itemName: '', spec: '', unitPrice: null }, id === MANUAL_ITEM);
                  else select(i, { itemId: item.id, itemName: item.name, spec: item.spec ?? '', unitPrice: rateAt(item.rates, date) }, false);
                }}
              />
            </label>
            {manual && (
              <label className="block">
                <span className="sr-only">品目名（{i + 1}行目）</span>
                <TextInput value={l.itemName} maxLength={100} placeholder="品目名" onChange={(v) => select(i, { itemName: v }, true)} />
              </label>
            )}
          </div>
        );
      },
    },
    { label: '規格', wide: true, cell: (l, i) => <TextInput value={l.spec} maxLength={200} onChange={(v) => set(i, { spec: v })} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v })} /> },
    { label: '数量', cell: (l, i) => <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} /> },
    {
      label: '単価',
      input: false,
      cell: (l, i, r) =>
        isManual(r) ? (
          <label className="block">
            <span className="sr-only">単価（円・{i + 1}行目）</span>
            <NumInput value={l.unitPrice} placeholder="円" onChange={(v) => set(i, { unitPrice: v })} />
          </label>
        ) : (
          <Computed>{l.unitPrice === null ? '未設定' : money(l.unitPrice)}</Computed>
        ),
    },
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
      hint="品目がプルダウンに無いときは「（手入力）」を選んで品目名と単価を入れます。よく使う品目は、管理者にマスターへの登録を頼んでください。"
      rowExtra={(l, i) => (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <ExtraField label="根拠（件）">
              <IssuePicker value={l.issueId} options={issueChoices} onChange={(id) => set(i, { issueId: id })} />
            </ExtraField>
          </div>
          <TaggedCostNote issueId={l.issueId} options={issueChoices} />
        </>
      )}
    />
  );
}
