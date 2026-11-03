'use client';

import { productivity, workAmount } from '@/lib/calc/report';
import type { Issue } from '@/lib/db/reports';
import { CHANGE_KINDS, CHANGE_KIND_LABELS, INSTRUCTION_METHODS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS, isChangeKind, isInstructionMethod } from '@/lib/report/change-labels';
import type { WorkLine } from '@/lib/types';
import { decimal, money, newLine, patchRow, removeRow, row, type Row } from '../form-state';
import { Computed, fieldClass, NumInput, Select, TextInput, type SelectOption } from '../inputs';
import { LineTable, type Column } from '../LineTable';

const methodOptions: SelectOption[] = INSTRUCTION_METHODS.map((m) => ({ value: m, label: INSTRUCTION_METHOD_LABELS[m] }));

/** 根拠の件の選択肢（重複は除く）。表示は「MM/DD 種別 本文の先頭 30 字」。 */
function issueOptions(issues: Issue[]): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const i of issues) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    const body = i.body.replace(/\s+/g, ' ').trim();
    const head = body.length > 30 ? `${body.slice(0, 30)}…` : body;
    out.push({ value: i.id, label: `${i.reportDate.slice(5).replace('-', '/')} ${ISSUE_KIND_LABELS[i.kind]} ${head}` });
  }
  return out;
}

function SubField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

/**
 * 作業内容（出来高）の表。歩掛 = 施工数量 ÷ 投入人工、合計金額 = 施工数量 × 施工単価。
 * 区分が追加・増・変更・減の行は、行の下に指示者・指示方法・指示日・根拠の件の欄を出す（契約内に戻しても値は消さず、欄を隠すだけ）。
 */
export function WorkTable({
  rows,
  onChange,
  units,
  issues,
}: {
  rows: Row<WorkLine>[];
  onChange: (update: (rows: Row<WorkLine>[]) => Row<WorkLine>[]) => void;
  units: string[];
  /** 根拠の件の候補（この日報の件と、現場の対応中の件）。 */
  issues: Issue[];
}) {
  const set = (i: number, patch: Partial<WorkLine>) => onChange((rs) => patchRow(rs, i, patch));
  const unitOptions = units.map((u) => ({ value: u, label: u }));
  const issueChoices = issueOptions(issues);

  const columns: Column<WorkLine>[] = [
    { label: '工種', wide: true, cell: (l, i) => <TextInput value={l.trade} maxLength={200} onChange={(v) => set(i, { trade: v })} /> },
    {
      label: '区分',
      wide: true,
      cell: (l, i) => (
        <select
          value={l.changeKind}
          onChange={(e) => set(i, { changeKind: isChangeKind(e.target.value) ? e.target.value : 'contract' })}
          className={fieldClass}
        >
          {CHANGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHANGE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      ),
    },
    { label: '施工内容', wide: true, cell: (l, i) => <TextInput value={l.description} maxLength={200} onChange={(v) => set(i, { description: v })} /> },
    { label: '施工数量', cell: (l, i) => <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v })} /> },
    { label: '投入人工', cell: (l, i) => <NumInput value={l.manDays} onChange={(v) => set(i, { manDays: v })} /> },
    { label: '施工単価', cell: (l, i) => <NumInput value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v })} /> },
    { label: '歩掛', input: false, cell: (l) => <Computed>{decimal(productivity(l.qty, l.manDays))}</Computed> },
    { label: '合計金額', input: false, cell: (l) => <Computed>{money(workAmount(l))}</Computed> },
  ];

  return (
    <LineTable
      title="作業内容"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(7rem,1fr)_5.5rem_minmax(9rem,2fr)_6rem_5rem_5.5rem_6.5rem_4.5rem_6.5rem_4.5rem]"
      minWidthClass="md:min-w-[62rem]"
      rowExtra={(l, i) =>
        l.changeKind === 'contract' ? null : (
          <div role="group" aria-label={`${i + 1}行目の${CHANGE_KIND_LABELS[l.changeKind]}の指示`} className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <SubField label="指示者">
              <TextInput value={l.instructedBy} maxLength={100} placeholder="例：施主 山田様" onChange={(v) => set(i, { instructedBy: v })} />
            </SubField>
            <SubField label="指示方法">
              <Select
                value={l.instructionMethod ?? ''}
                options={methodOptions}
                placeholder="—"
                onChange={(v) => set(i, { instructionMethod: isInstructionMethod(v) ? v : null })}
              />
            </SubField>
            <SubField label="指示日">
              <input
                type="date"
                value={l.instructedOn ?? ''}
                onChange={(e) => set(i, { instructedOn: e.target.value === '' ? null : e.target.value })}
                className={fieldClass}
              />
            </SubField>
            <SubField label="根拠の件">
              <Select
                value={l.issueId ?? ''}
                options={issueChoices}
                placeholder="なし"
                missingLabel="（一覧に無い件）"
                onChange={(v) => set(i, { issueId: v === '' ? null : v })}
              />
            </SubField>
          </div>
        )
      }
      onAdd={() => onChange((rs) => [...rs, row(newLine.work())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="出来高 小計"
      subtotal={money(rows.reduce((s, r) => s + workAmount(r.line), 0))}
      emptyText="作業内容はまだありません。"
    />
  );
}
