'use client';

import type { ReactNode } from 'react';
import { amount } from '@/lib/calc/report';
import type { CashLineInput, CreditLineInput } from '@/lib/report/schema';
import { money, newLine, patchRow, removeRow, row, type Row, type SupplierOption } from '../form-state';
import { Computed, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';

type PurchaseLine = CashLineInput | CreditLineInput;

function rowAmount<L extends PurchaseLine>(r: Row<L>): number {
  return r.amountMode ? (r.line.amountOnly ?? 0) : amount(r.line.qty, r.line.unitPrice);
}

/** 現金・買掛の表（共通）。「金額のみ入力」にすると数量・単価の代わりに金額を入れる。 */
function PurchaseTable<L extends PurchaseLine>({
  title,
  priceLabel,
  vendorLabel,
  amountLabel,
  rows,
  onChange,
  units,
  vendorCell,
  create,
  gridClass,
}: {
  title: string;
  priceLabel: string;
  vendorLabel: string;
  amountLabel: string;
  rows: Row<L>[];
  onChange: (update: (rows: Row<L>[]) => Row<L>[]) => void;
  units: string[];
  vendorCell: (line: L, set: (patch: Partial<L>) => void) => ReactNode;
  create: () => L;
  gridClass: string;
}) {
  const set = (i: number, patch: Partial<L>) => onChange((rs) => patchRow(rs, i, patch));
  const unitOptions = units.map((u) => ({ value: u, label: u }));
  const toggle = (i: number, on: boolean) =>
    onChange((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        if (on) {
          const current = r.line.qty !== null && r.line.unitPrice !== null ? amount(r.line.qty, r.line.unitPrice) : null;
          return { ...r, amountMode: true, line: { ...r.line, qty: null, unitPrice: null, amountOnly: current } };
        }
        return { ...r, amountMode: false, line: { ...r.line, amountOnly: undefined } };
      }),
    );

  const columns: Column<L>[] = [
    { label: '品目', wide: true, cell: (l, i) => <TextInput value={l.itemName} maxLength={100} onChange={(v) => set(i, { itemName: v } as Partial<L>)} /> },
    { label: '規格', wide: true, cell: (l, i) => <TextInput value={l.spec} maxLength={200} onChange={(v) => set(i, { spec: v } as Partial<L>)} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v } as Partial<L>)} /> },
    {
      label: '数量',
      cell: (l, i, r) =>
        r.amountMode ? <Computed>—</Computed> : <NumInput value={l.qty} onChange={(v) => set(i, { qty: v } as Partial<L>)} />,
    },
    {
      label: priceLabel,
      cell: (l, i, r) =>
        r.amountMode ? <Computed>—</Computed> : <NumInput value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v } as Partial<L>)} />,
    },
    { label: vendorLabel, wide: true, cell: (l, i) => vendorCell(l, (patch) => set(i, patch)) },
    {
      label: '金額のみ入力',
      cell: (_l, i, r) => (
        <span className="flex min-h-11 items-center">
          <input
            type="checkbox"
            checked={r.amountMode === true}
            onChange={(e) => toggle(i, e.target.checked)}
            className="size-6"
          />
        </span>
      ),
    },
    {
      label: amountLabel,
      input: false,
      cell: (l, i, r) =>
        r.amountMode ? (
          <label className="block">
            <span className="sr-only">{amountLabel}（{i + 1}行目）</span>
            <NumInput value={l.amountOnly ?? null} onChange={(v) => set(i, { amountOnly: v } as Partial<L>)} />
          </label>
        ) : (
          <Computed>{money(rowAmount(r))}</Computed>
        ),
    },
  ];

  return (
    <LineTable
      title={title}
      rows={rows}
      columns={columns}
      gridClass={gridClass}
      minWidthClass="md:min-w-[60rem]"
      onAdd={() => onChange((rs) => [...rs, row(create())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel={`${amountLabel} 小計`}
      subtotal={money(rows.reduce((s, r) => s + rowAmount(r), 0))}
      emptyText={`${title}はまだありません。`}
    />
  );
}

const GRID = 'md:grid-cols-[minmax(7rem,1.5fr)_minmax(6rem,1fr)_5rem_5rem_6rem_minmax(7rem,1.5fr)_4.5rem_6.5rem_4.5rem]';

export function CashTable({
  rows,
  onChange,
  units,
}: {
  rows: Row<CashLineInput>[];
  onChange: (update: (rows: Row<CashLineInput>[]) => Row<CashLineInput>[]) => void;
  units: string[];
}) {
  return (
    <PurchaseTable<CashLineInput>
      title="現金"
      priceLabel="購入単価"
      vendorLabel="購入先"
      amountLabel="購入金額"
      rows={rows}
      onChange={onChange}
      units={units}
      gridClass={GRID}
      create={newLine.cash}
      vendorCell={(l, set) => <TextInput value={l.vendor} maxLength={200} onChange={(v) => set({ vendor: v })} />}
    />
  );
}

export function CreditTable({
  rows,
  onChange,
  units,
  suppliers,
}: {
  rows: Row<CreditLineInput>[];
  onChange: (update: (rows: Row<CreditLineInput>[]) => Row<CreditLineInput>[]) => void;
  units: string[];
  suppliers: SupplierOption[];
}) {
  const options = suppliers.map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name}（無効）` }));
  return (
    <PurchaseTable<CreditLineInput>
      title="買掛"
      priceLabel="仕入単価"
      vendorLabel="仕入先"
      amountLabel="仕入金額"
      rows={rows}
      onChange={onChange}
      units={units}
      gridClass={GRID}
      create={newLine.credit}
      vendorCell={(l, set) => (
        <Select
          value={l.supplierId ?? ''}
          options={options}
          missingLabel={l.vendor || '（不明な仕入先）'}
          onChange={(id) => {
            const s = suppliers.find((x) => x.id === id);
            set(s ? { supplierId: s.id, vendor: s.name } : { supplierId: null, vendor: '' });
          }}
        />
      )}
    />
  );
}
