'use client';

import type { ReactNode } from 'react';
import { amount } from '@/lib/calc/report';
import type { SiteTrade } from '@/lib/budget/types';
import type { IssueOption } from '@/lib/report/issue-options';
import { PURCHASE_KIND_LABELS } from '@/lib/report/purchase-kind';
import type { CashLineInput, CreditLineInput } from '@/lib/report/schema';
import { isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type Row, type SupplierOption } from '../form-state';
import { Computed, fieldClass, NumInput, Select, TextInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import { ExtraField, IssuePicker } from './IssuePicker';

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
  hint,
  rowExtra,
}: {
  title: string;
  priceLabel: string;
  vendorLabel: string;
  amountLabel: string;
  rows: Row<L>[];
  onChange: (update: (rows: Row<L>[]) => Row<L>[]) => void;
  units: string[];
  /** 購入先・支払先の欄。label は自分で付ける（手入力では欄が 2 つになるため）。 */
  vendorCell: (line: L, set: (patch: Partial<L>) => void, row: Row<L>, index: number) => ReactNode;
  create: () => L;
  gridClass: string;
  hint?: string;
  /** 行の下の欄（区分・工種・根拠の件）。 */
  rowExtra?: (line: L, index: number, row: Row<L>) => ReactNode;
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
    { label: vendorLabel, wide: true, input: false, cell: (l, i, r) => vendorCell(l, (patch) => set(i, patch), r, i) },
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
      hint={hint}
      rowExtra={rowExtra}
    />
  );
}

/** 支払先の選択肢の末尾に置く「（手入力）」の値（会社の ID は uuid なので重ならない）。 */
const MANUAL_SUPPLIER = '__manual__';

const GRID = 'md:grid-cols-[minmax(7rem,1.5fr)_minmax(6rem,1fr)_5rem_5rem_6rem_minmax(7rem,1.5fr)_4.5rem_6.5rem_4.5rem]';

export function CashTable({
  rows,
  onChange,
  units,
  issueChoices,
}: {
  rows: Row<CashLineInput>[];
  onChange: (update: (rows: Row<CashLineInput>[]) => Row<CashLineInput>[]) => void;
  units: string[];
  /** 根拠の件の選択肢（issueOptions）。 */
  issueChoices: IssueOption[];
}) {
  const set = (i: number, patch: Partial<CashLineInput>) => onChange((rs) => patchRow(rs, i, patch));
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
      vendorCell={(l, set, _r, i) => (
        <label className="block">
          <span className="sr-only">購入先（{i + 1}行目）</span>
          <TextInput value={l.vendor} maxLength={200} onChange={(v) => set({ vendor: v })} />
        </label>
      )}
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

/**
 * 買掛の表。区分（仕入／外注）・工種（外注のときだけ）・根拠（件）は行の下の欄（2026-11-17）。
 * - subcontractSuppliers が undefined（協力会社のアカウント・SQL の前）なら区分の欄を出さない（常に仕入）。
 * - 外注の行の支払先は subcontractSuppliers（現場の協力会社）から選ぶ（手入力は不可）。仕入の行は今までどおり取引先＋手入力。
 * - 区分を切り替えたとき、いまの支払先が切り替え先の選択肢に無ければ空にする。仕入に戻すと工種は外す。
 */
export function CreditTable({
  rows,
  onChange,
  units,
  suppliers,
  subcontractSuppliers,
  trades,
  issueChoices,
}: {
  rows: Row<CreditLineInput>[];
  onChange: (update: (rows: Row<CreditLineInput>[]) => Row<CreditLineInput>[]) => void;
  units: string[];
  suppliers: SupplierOption[];
  subcontractSuppliers?: SupplierOption[];
  trades: SiteTrade[];
  issueChoices: IssueOption[];
}) {
  const label = (s: SupplierOption) => (s.active ? s.name : `${s.name}（無効）`);
  const options = [...suppliers.map((s) => ({ value: s.id, label: label(s) })), { value: MANUAL_SUPPLIER, label: '（手入力）' }];
  const subOptions = (subcontractSuppliers ?? []).map((s) => ({ value: s.id, label: label(s) }));
  const tradeOptions = trades.map((t) => ({ value: t.id, label: t.name }));
  // 支払先の選び直しと手入力の支払先名：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<CreditLineInput>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const set = (i: number, patch: Partial<CreditLineInput>) => onChange((rs) => patchRow(rs, i, patch));
  const changeKind = (i: number, l: CreditLineInput, sub: boolean) => {
    const list = sub ? (subcontractSuppliers ?? []) : suppliers;
    const keep = l.supplierId !== null && list.some((s) => s.id === l.supplierId);
    select(
      i,
      {
        purchaseKind: sub ? 'subcontract' : 'material',
        ...(sub ? {} : { siteTradeId: null }),
        ...(keep ? {} : { supplierId: null, vendor: '' }),
      },
      false,
    );
  };
  return (
    <PurchaseTable<CreditLineInput>
      title="買掛"
      priceLabel="単価"
      vendorLabel="支払先"
      amountLabel="支払金額"
      rows={rows}
      onChange={onChange}
      units={units}
      gridClass={GRID}
      create={newLine.credit}
      hint={
        subcontractSuppliers
          ? '外注（請負の支払い）は、行の下の区分で「外注」を選び、工種と支払先（協力会社）を選びます。仕入の支払先がプルダウンに無いときは「（手入力）」を選んで支払先名を入れます。'
          : '支払先がプルダウンに無いときは「（手入力）」を選んで支払先名を入れます。よく使う支払先は、管理者にマスターへの登録を頼んでください。'
      }
      vendorCell={(l, _set, r, i) => {
        if (l.purchaseKind === 'subcontract') {
          return (
            <label className="block">
              <span className="sr-only">支払先（{i + 1}行目）</span>
              <Select
                value={l.supplierId ?? ''}
                options={subOptions}
                placeholder="協力会社を選んでください"
                missingLabel={l.vendor || '（不明な支払先）'}
                onChange={(id) => {
                  const s = (subcontractSuppliers ?? []).find((x) => x.id === id);
                  select(i, s ? { supplierId: s.id, vendor: s.name } : { supplierId: null, vendor: '' }, false);
                }}
              />
            </label>
          );
        }
        const manual = isManualRow(r, l.supplierId, l.vendor);
        return (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">支払先（{i + 1}行目）</span>
              <Select
                value={l.supplierId ?? (manual ? MANUAL_SUPPLIER : '')}
                options={options}
                missingLabel={l.vendor || '（不明な支払先）'}
                onChange={(id) => {
                  const s = suppliers.find((x) => x.id === id);
                  if (s) select(i, { supplierId: s.id, vendor: s.name }, false);
                  else select(i, { supplierId: null, vendor: '' }, id === MANUAL_SUPPLIER);
                }}
              />
            </label>
            {manual && (
              <label className="block">
                <span className="sr-only">支払先名（{i + 1}行目）</span>
                <TextInput
                  value={l.vendor}
                  maxLength={200}
                  placeholder="支払先名"
                  onChange={(v) => select(i, { vendor: v }, true)}
                />
              </label>
            )}
          </div>
        );
      }}
      rowExtra={(l, i) => {
        const sub = l.purchaseKind === 'subcontract';
        return (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {(subcontractSuppliers !== undefined || sub) && (
              <ExtraField label="区分">
                <select
                  value={l.purchaseKind}
                  disabled={subcontractSuppliers === undefined}
                  onChange={(e) => changeKind(i, l, e.target.value === 'subcontract')}
                  className={fieldClass}
                >
                  <option value="material">{PURCHASE_KIND_LABELS.material}（材料など）</option>
                  <option value="subcontract">{PURCHASE_KIND_LABELS.subcontract}（請負の支払い）</option>
                </select>
              </ExtraField>
            )}
            {sub && tradeOptions.length > 0 && (
              <ExtraField label="工種（実行予算）">
                <Select
                  value={l.siteTradeId ?? ''}
                  options={tradeOptions}
                  placeholder="選んでください"
                  missingLabel="（実行予算に無い工種）"
                  onChange={(v) => set(i, { siteTradeId: v === '' ? null : v })}
                />
              </ExtraField>
            )}
            <ExtraField label="根拠（件）">
              <IssuePicker value={l.issueId} options={issueChoices} onChange={(id) => set(i, { issueId: id })} />
            </ExtraField>
          </div>
        );
      }}
    />
  );
}
