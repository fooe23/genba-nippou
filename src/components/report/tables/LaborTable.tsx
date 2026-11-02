'use client';

import { rateAt } from '@/lib/calc/rates';
import { laborLineValues } from '@/lib/calc/report';
import type { LaborLine, LaborRule, TimeSpec } from '@/lib/types';
import { decimal, money, newLine, patchRow, removeRow, row, type Row, type WorkerOption } from '../form-state';
import { Computed, NumInput, Select, TextInput, TimeInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';

/**
 * 作業員の表。日当は選んだ作業員の単価履歴（日報の日付時点）を、残業単価は作業員マスターの値を複写する。
 * 時間は空欄なら共通時間。人工・残業・労務費は rule（労務の設定）で計算する。
 */
export function LaborTable({
  rows,
  onChange,
  common,
  rule,
  date,
  workers,
}: {
  rows: Row<LaborLine>[];
  onChange: (update: (rows: Row<LaborLine>[]) => Row<LaborLine>[]) => void;
  common: TimeSpec;
  rule: LaborRule;
  date: string;
  workers: WorkerOption[];
}) {
  const set = (i: number, patch: Partial<LaborLine>) => onChange((rs) => patchRow(rs, i, patch));
  const setTime = (i: number, line: LaborLine, patch: Partial<TimeSpec>) => set(i, { time: { ...line.time, ...patch } });
  const options = workers.map((w) => ({ value: w.id, label: w.active ? w.name : `${w.name}（無効）` }));
  const commonBreak = common.breakMin === null ? '' : `共通${common.breakMin}`;
  const commonGap = common.gapMin === null ? '' : `共通${common.gapMin}`;

  const columns: Column<LaborLine>[] = [
    {
      label: '作業員',
      wide: true,
      cell: (l, i) => (
        <Select
          value={l.workerId ?? ''}
          options={options}
          missingLabel={l.workerName || '（不明な作業員）'}
          onChange={(id) => {
            const w = workers.find((x) => x.id === id);
            if (!w) set(i, { workerId: null, workerName: '', dailyRate: null, overtimeRate: null });
            else set(i, { workerId: w.id, workerName: w.name, dailyRate: rateAt(w.rates, date), overtimeRate: w.overtimeRate });
          }}
        />
      ),
    },
    { label: '開始', cell: (l, i) => <TimeInput value={l.time.start} onChange={(v) => setTime(i, l, { start: v })} /> },
    { label: '終了', cell: (l, i) => <TimeInput value={l.time.end} onChange={(v) => setTime(i, l, { end: v })} /> },
    {
      label: '休憩（分）',
      cell: (l, i) => <NumInput integer value={l.time.breakMin} placeholder={commonBreak} onChange={(v) => setTime(i, l, { breakMin: v })} />,
    },
    {
      label: '中抜（分）',
      cell: (l, i) => <NumInput integer value={l.time.gapMin} placeholder={commonGap} onChange={(v) => setTime(i, l, { gapMin: v })} />,
    },
    { label: '備考', wide: true, cell: (l, i) => <TextInput value={l.note} maxLength={200} onChange={(v) => set(i, { note: v })} /> },
    { label: '実働H', input: false, cell: (l) => <Computed>{decimal(laborLineValues(l, common, rule).hours)}</Computed> },
    { label: '人工', input: false, cell: (l) => <Computed>{decimal(laborLineValues(l, common, rule).manDays)}</Computed> },
    { label: '残業H', input: false, cell: (l) => <Computed>{decimal(laborLineValues(l, common, rule).overtimeHours)}</Computed> },
    { label: '日当', input: false, cell: (l) => <Computed>{l.dailyRate === null ? '未設定' : money(l.dailyRate)}</Computed> },
    { label: '労務費', input: false, cell: (l) => <Computed>{money(laborLineValues(l, common, rule).cost)}</Computed> },
  ];

  const subtotal = rows.reduce((s, r) => s + laborLineValues(r.line, common, rule).cost, 0);
  return (
    <LineTable
      title="作業員"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(9rem,2fr)_7rem_7rem_5rem_5rem_minmax(6rem,1.5fr)_3.5rem_3.5rem_3.5rem_5.5rem_6rem_4.5rem]"
      minWidthClass="md:min-w-[70rem]"
      onAdd={() => onChange((rs) => [...rs, row(newLine.labor())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="労務費 小計"
      subtotal={money(subtotal)}
      emptyText="作業員はまだありません。「＋追加」で入力します。時間を空欄にすると共通時間で計算します。"
    />
  );
}
