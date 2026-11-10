'use client';

import { affiliationLabel, LABOR_CONTRACT_LABELS, laborContractValue, laborRowAffiliation, type StoredLaborAffiliations } from '@/lib/calc/affiliation';
import { defaultLaborContract, laborCostNote, type LaborCostContext } from '@/lib/calc/labor-cost';
import { rateAt } from '@/lib/calc/rates';
import { formLaborSplit } from '@/lib/report/labor-form';
import { laborLineValues } from '@/lib/calc/report';
import type { LaborContract, LaborLine, LaborRule, TimeSpec } from '@/lib/types';
import {
  isUnnamedLabor,
  UNNAMED_OPTION_LABEL,
  UNNAMED_SAFETY_NOTE,
  UNNAMED_SUFFIX,
  unnamedWorkerName,
} from '@/lib/report/unnamed-workers';
import { decimal, isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type Row, type SupplierOption, type WorkerOption } from '../form-state';
import { Computed, fieldClass, NumInput, Select, TextInput, TimeInput } from '../inputs';
import { LineTable, type Column } from '../LineTable';

/** 作業員の選択肢の末尾に置く「（手入力）」の値（作業員の ID は uuid なので重ならない）。 */
const MANUAL_WORKER = '__manual__';
/** 「（名前なし：会社と人数で入れる）」の値（2026-11-19）。 */
const UNNAMED_WORKER = '__unnamed__';

/**
 * 作業員の表。日当は選んだ作業員の単価履歴（日報の日付時点）を、残業単価は作業員マスターの値を複写する。
 * 時間は空欄なら共通時間。人工・残業・労務費は rule（労務の設定）で計算する。
 * マスターに無い人は「（手入力）」を選び、氏名と日当を入れる（workerId は null。残業単価は標準の計算式）。
 * 作業員の欄の下に所属（自社／取引先名／所属なし）を小さく出し、協力会社の作業員の行だけ「常用／請負」を選ぶ
 * （列は増やさず作業員の欄に重ねて、md・xl の幅で右端の列が切れないようにする）。作業員を選んだときの既定は、
 * 実行予算でその会社が請負の行に入っていれば請負、入っていなければ常用（決めたこと A。保存済みの行の区分は変えない）。
 * 区分が請負の行だけ「うち常用の時間」（H。空欄＝全部が請負）を出し、その下に原価に数える分を小さく出す。
 * 労務費の列と小計は原価に数える分（src/lib/calc/labor-cost.ts。協力会社のアカウントは実行予算の単価が無いので日当で数える）。
 * 名前なし（会社と人数）の行（2026-11-19。src/lib/report/unnamed-workers.ts）：「（名前なし：会社と人数で入れる）」を選び、
 * 会社（協力会社）・人数・日当（1 人分）を入れる。時間・うち常用の時間は 1 人あたり、人工・残業・労務費は人数分。
 * unnamedCompanies が undefined（DB に人数の列が無い）なら選択肢を出さない。
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
  laborCost,
  ukeoiSupplierIds = [],
  unnamedCompanies,
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
  /** 労務費の決まりの材料（省略時は行の金額のまま）。 */
  laborCost?: LaborCostContext;
  /** 実行予算で請負の行に入っている会社（作業員を選んだときの常用・請負の既定）。 */
  ukeoiSupplierIds?: readonly string[];
  /** 名前なしの行の会社（現場に関わる協力会社）。undefined は「名前なし」の選択肢を出さない（SQL の前）。 */
  unnamedCompanies?: SupplierOption[];
}) {
  const set = (i: number, patch: Partial<LaborLine>) => onChange((rs) => patchRow(rs, i, patch));
  // 作業員の選び直しと手入力の氏名：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<LaborLine>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const isUnnamed = (l: LaborLine) => l.workerId === null && isUnnamedLabor(l);
  const isManual = (r: Row<LaborLine>) => !isUnnamed(r.line) && isManualRow(r, r.line.workerId, r.line.workerName);
  const setTime = (i: number, line: LaborLine, patch: Partial<TimeSpec>) => set(i, { time: { ...line.time, ...patch } });
  // 行ごとに 1 回だけ計算する（表示列と小計で共用）。
  const values = rows.map((r) => laborLineValues(r.line, common, rule, { preferSaved }));
  const options = [
    ...workers.map((w) => ({ value: w.id, label: w.active ? w.name : `${w.name}（無効）` })),
    { value: MANUAL_WORKER, label: '（手入力）' },
    // SQL の前は出さない（保存済みの名前なしの行があれば、その行の表示のために出す）。
    ...(unnamedCompanies !== undefined || rows.some((r) => isUnnamed(r.line)) ? [{ value: UNNAMED_WORKER, label: UNNAMED_OPTION_LABEL }] : []),
  ];
  const companyOptions = (unnamedCompanies ?? []).map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name}（無効）` }));
  const workerById = new Map(workers.map((w) => [w.id, w]));
  // 原価に数える分（労務費の決まり）。
  const splits = rows.map((r, i) =>
    laborCost
      ? formLaborSplit(r.line, values[i], stored, r.line.workerId ? workerById.get(r.line.workerId) : undefined, laborCost)
      : null,
  );
  const costOf = (i: number) => splits[i]?.countedCost ?? values[i].cost;
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
        const unnamed = isUnnamed(l);
        const a = laborRowAffiliation(l, stored, l.workerId ? workerById.get(l.workerId) : undefined);
        const aff = { label: affiliationLabel(a.affiliation, a.supplierId, supplierNames), partner: a.affiliation === 'partner' };
        return (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">作業員（{i + 1}行目）</span>
              <Select
                value={l.workerId ?? (unnamed ? UNNAMED_WORKER : manual ? MANUAL_WORKER : '')}
                options={options}
                missingLabel={l.workerName || '（不明な作業員）'}
                onChange={(id) => {
                  const w = workers.find((x) => x.id === id);
                  // 選び直したら所属の写しを外し（所属は保存済みの写しかマスターで決まる）、うち常用の時間を空にする。
                  // 常用・請負は既定（協力会社で実行予算の請負の行に入っている会社 → 請負、それ以外 → 常用。自社・手入力は null）。
                  // 人数は名前なしの行だけ（選ぶと 0＝人数の入力待ち。空のままでは保存で止める）。
                  const reset = { affiliation: null, supplierId: null, laborContract: null, jouyouHours: null, headcount: null };
                  if (id === UNNAMED_WORKER) {
                    select(i, { workerId: null, workerName: UNNAMED_SUFFIX, dailyRate: null, overtimeRate: null, ...reset, headcount: 0 }, false);
                  } else if (!w) select(i, { workerId: null, workerName: '', dailyRate: null, overtimeRate: null, ...reset }, id === MANUAL_WORKER);
                  else {
                    const a = laborRowAffiliation({ workerId: w.id }, stored, w);
                    select(
                      i,
                      { workerId: w.id, workerName: w.name, dailyRate: rateAt(w.rates, date), overtimeRate: w.overtimeRate, ...reset, laborContract: defaultLaborContract(a, ukeoiSupplierIds) },
                      false,
                    );
                  }
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
            {unnamed && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="block min-w-0 flex-1 basis-40">
                  <span className="sr-only">会社（{i + 1}行目）</span>
                  <Select
                    value={l.supplierId ?? ''}
                    options={companyOptions}
                    placeholder="会社を選ぶ"
                    missingLabel={(l.supplierId ? supplierNames[l.supplierId] : undefined) || l.workerName.replace(UNNAMED_SUFFIX, '') || '（不明な会社）'}
                    onChange={(id) => {
                      const c = unnamedCompanies?.find((x) => x.id === id);
                      // 会社を選び直したら、常用・請負を既定（実行予算で請負の会社 → 請負、それ以外 → 常用）に、うち常用の時間を空にする。
                      set(i, {
                        supplierId: id || null,
                        workerName: id ? unnamedWorkerName(c?.name ?? supplierNames[id] ?? '') : UNNAMED_SUFFIX,
                        laborContract: id ? defaultLaborContract({ affiliation: 'partner', supplierId: id }, ukeoiSupplierIds) : null,
                        jouyouHours: null,
                      });
                    }}
                  />
                </label>
                <label className="flex shrink-0 items-center gap-1">
                  <span className="sr-only">人数（{i + 1}行目）</span>
                  <span className="block w-20 shrink-0">
                    <NumInput
                      integer
                      value={l.headcount === 0 ? null : (l.headcount ?? null)}
                      placeholder="人数"
                      // 空欄は 0（名前なしの行のまま。保存のときに「人数は1以上」で止める）。
                      onChange={(v) => set(i, { headcount: v ?? 0 })}
                    />
                  </span>
                  <span className="text-sm">名</span>
                </label>
              </div>
            )}
            {(l.workerId !== null || manual || (unnamed && l.supplierId)) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {!unnamed && <span className="min-w-0 break-words text-xs text-gray-600 dark:text-gray-400">所属：{aff.label}</span>}
                {aff.partner && (
                  <label className="block w-24 shrink-0">
                    <span className="sr-only">常用・請負（{i + 1}行目）</span>
                    <select
                      value={laborContractValue(l, stored)}
                      // 常用に切り替えたら、うち常用の時間は空にする（常用の行は全部が常用）。
                      onChange={(e) =>
                        set(i, e.target.value === 'ukeoi' ? { laborContract: 'ukeoi' } : { laborContract: 'jouyou', jouyouHours: null })
                      }
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
                {aff.partner && laborContractValue(l, stored) === 'ukeoi' && (
                  <label className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400">うち常用</span>
                    <span className="sr-only">の時間（H・{i + 1}行目。空欄は全部が請負）</span>
                    <span className="block w-20 shrink-0">
                      <NumInput value={l.jouyouHours ?? null} placeholder="H" onChange={(v) => set(i, { jouyouHours: v })} />
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">H</span>
                  </label>
                )}
              </div>
            )}
            {unnamed && <p className="text-xs text-amber-800 dark:text-amber-300">{UNNAMED_SAFETY_NOTE}</p>}
            {(() => {
              const note = splits[i] ? laborCostNote(splits[i]) : null;
              return note ? <p className="text-xs text-gray-600 dark:text-gray-400">{note}</p> : null;
            })()}
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
        isManual(r) || isUnnamed(l) ? (
          <label className="block">
            <span className="sr-only">日当（円・{isUnnamed(l) ? '1人分・' : ''}{i + 1}行目）</span>
            <NumInput integer value={l.dailyRate} placeholder="円" onChange={(v) => set(i, { dailyRate: v })} />
          </label>
        ) : (
          <Computed>{l.dailyRate === null ? '未設定' : money(l.dailyRate)}</Computed>
        ),
    },
    { label: '労務費', input: false, cell: (_l, i) => <Computed>{money(costOf(i))}</Computed> },
  ];

  const subtotal = values.reduce((s, _v, i) => s + costOf(i), 0);
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
      hint="自社の作業員がプルダウンに無いときは、管理者が 管理 → 現場 → ③ この現場で使うマスター で追加できます（何も選んでいない現場は有効な自社の作業員全員が出ます）。協力会社の作業員は、社員が現場の画面の「協力会社と作業員」で登録すると出ます。一度だけ来る人は「（手入力）」を選んで氏名と日当を入れます。協力会社の人の名前が分からないときは「（名前なし：会社と人数で入れる）」で会社・人数・1人分の日当を入れます（時間は1人分、人工・労務費は人数分）。"
    />
  );
}
