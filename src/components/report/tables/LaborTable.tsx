'use client';

import { affiliationLabel, LABOR_CONTRACT_LABELS, laborContractValue, laborRowAffiliation, type StoredLaborAffiliations } from '@/lib/calc/affiliation';
import { rateAt } from '@/lib/calc/rates';
import { laborLineValues } from '@/lib/calc/report';
import type { LaborContract, LaborLine, LaborRule, TimeSpec } from '@/lib/types';
import { decimal, isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type Row, type WorkerOption } from '../form-state';
import { Computed, fieldClass, NumInput, Select, TextInput, TimeInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';

/** 作業員の選択肢の末尾に置く「（手入力）」の値（作業員の ID は uuid なので重ならない）。 */
const MANUAL_WORKER = '__manual__';

/**
 * 作業員の表。日当は選んだ作業員の単価履歴（日報の日付時点）を、残業単価は作業員マスターの値を複写する。
 * 時間は空欄なら共通時間。人工・残業・労務費は rule（労務の設定）で計算する。
 * マスターに無い人は「（手入力）」を選び、氏名と日当を入れる（workerId は null。残業単価は標準の計算式）。
 * 作業員の欄の下に所属（自社／取引先名／所属なし）を小さく出し、協力会社の作業員の行だけ「常用／請負」を選ぶ
 * （既定は常用。列は増やさず作業員の欄に重ねて、md・xl の幅で右端の列が切れないようにする）。
 */
export function LaborTable({
  rows,
  onChange,
  common,
  rule,
  preferSaved = false,
  date,
  workers,
  supplierNames = {},
  stored = new Map(),
}: {
  rows: Row<LaborLine>[];
  onChange: (update: (rows: Row<LaborLine>[]) => Row<LaborLine>[]) => void;
  common: TimeSpec;
  rule: LaborRule;
  /** 読み取り専用の画面：保存済みの行は DB の計算値（保存時の設定）で表示する。 */
  preferSaved?: boolean;
  date: string;
  workers: WorkerOption[];
  /** 取引先 ID → 名前（所属の表示用）。 */
  supplierNames?: Record<string, string>;
  /** 日報を開いたときに読み込んだ保存済みの行の所属・常用請負の写し（作業員ごと）。保存し直しでサーバーが使うものと同じ。 */
  stored?: StoredLaborAffiliations;
}) {
  const set = (i: number, patch: Partial<LaborLine>) => onChange((rs) => patchRow(rs, i, patch));
  // 作業員の選び直しと手入力の氏名：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<LaborLine>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const isManual = (r: Row<LaborLine>) => isManualRow(r, r.line.workerId, r.line.workerName);
  const setTime = (i: number, line: LaborLine, patch: Partial<TimeSpec>) => set(i, { time: { ...line.time, ...patch } });
  // 行ごとに 1 回だけ計算する（表示列と小計で共用）。
  const values = rows.map((r) => laborLineValues(r.line, common, rule, { preferSaved }));
  const options = [
    ...workers.map((w) => ({ value: w.id, label: w.active ? w.name : `${w.name}（無効）` })),
    { value: MANUAL_WORKER, label: '（手入力）' },
  ];
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const contractOptions = (Object.keys(LABOR_CONTRACT_LABELS) as LaborContract[]).map((c) => ({ value: c, label: LABOR_CONTRACT_LABELS[c] }));
  const commonBreak = common.breakMin === null ? '' : `共通${common.breakMin}`;
  const commonGap = common.gapMin === null ? '' : `共通${common.gapMin}`;

  const columns: Column<LaborLine>[] = [
    {
      label: '作業員',
      wide: true,
      // 手入力の行は選択と氏名の 2 つの欄になるので、それぞれに label を付ける。
      input: false,
      cell: (l, i, r) => {
        const manual = isManual(r);
        const a = laborRowAffiliation(l, stored, l.workerId ? workerById.get(l.workerId) : undefined);
        const aff = { label: affiliationLabel(a.affiliation, a.supplierId, supplierNames), partner: a.affiliation === 'partner' };
        return (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">作業員（{i + 1}行目）</span>
              <Select
                value={l.workerId ?? (manual ? MANUAL_WORKER : '')}
                options={options}
                missingLabel={l.workerName || '（不明な作業員）'}
                onChange={(id) => {
                  const w = workers.find((x) => x.id === id);
                  // 選び直したら常用・請負は既定の常用（null）に戻す。所属の写しも外す（所属は保存済みの写しかマスターで決まる）。
                  const reset = { affiliation: null, supplierId: null, laborContract: null };
                  if (!w) select(i, { workerId: null, workerName: '', dailyRate: null, overtimeRate: null, ...reset }, id === MANUAL_WORKER);
                  else select(i, { workerId: w.id, workerName: w.name, dailyRate: rateAt(w.rates, date), overtimeRate: w.overtimeRate, ...reset }, false);
                }}
              />
            </label>
            {manual && (
              <label className="block">
                <span className="sr-only">氏名（{i + 1}行目）</span>
                <TextInput
                  value={l.workerName}
                  maxLength={100}
                  placeholder="氏名"
                  onChange={(v) => select(i, { workerName: v }, true)}
                />
              </label>
            )}
            {(l.workerId !== null || manual) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words text-xs text-gray-600 dark:text-gray-400">所属：{aff.label}</span>
                {aff.partner && (
                  <label className="block w-24 shrink-0">
                    <span className="sr-only">常用・請負（{i + 1}行目）</span>
                    <select
                      value={laborContractValue(l, stored)}
                      onChange={(e) => set(i, { laborContract: e.target.value === 'ukeoi' ? 'ukeoi' : 'jouyou' })}
                      className={fieldClass}
                    >
                      {contractOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        );
      },
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
    { label: '実働H', input: false, cell: (_l, i) => <Computed>{decimal(values[i].hours)}</Computed> },
    { label: '人工', input: false, cell: (_l, i) => <Computed>{decimal(values[i].manDays)}</Computed> },
    { label: '残業H', input: false, cell: (_l, i) => <Computed>{decimal(values[i].overtimeHours)}</Computed> },
    {
      label: '日当',
      input: false,
      cell: (l, i, r) =>
        isManual(r) ? (
          <label className="block">
            <span className="sr-only">日当（円・{i + 1}行目）</span>
            <NumInput integer value={l.dailyRate} placeholder="円" onChange={(v) => set(i, { dailyRate: v })} />
          </label>
        ) : (
          <Computed>{l.dailyRate === null ? '未設定' : money(l.dailyRate)}</Computed>
        ),
    },
    { label: '労務費', input: false, cell: (_l, i) => <Computed>{money(values[i].cost)}</Computed> },
  ];

  const subtotal = values.reduce((s, v) => s + v.cost, 0);
  return (
    <LineTable
      title="作業員"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(8.5rem,2fr)_6.5rem_6.5rem_5rem_5rem_minmax(5rem,1.5fr)_3.5rem_3.5rem_3.5rem_5.5rem_6rem_4.5rem]"
      minWidthClass="md:min-w-[69rem]"
      onAdd={() => onChange((rs) => [...rs, row(newLine.labor())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="労務費 小計"
      subtotal={money(subtotal)}
      emptyText="作業員はまだありません。「＋追加」で入力します。時間を空欄にすると共通時間で計算します。"
      hint="自社の作業員がプルダウンに無いときは、管理者が 管理 → 現場 → ③ この現場で使うマスター で追加できます（何も選んでいない現場は有効な自社の作業員全員が出ます）。協力会社の作業員は、社員が現場の画面の「協力会社と作業員」で登録すると出ます。一度だけ来る人は「（手入力）」を選んで氏名と日当を入れます。"
    />
  );
}
