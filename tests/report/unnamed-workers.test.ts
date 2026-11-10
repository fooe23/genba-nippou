import { describe, expect, it } from 'vitest';
import { attendance, workerCumulative } from '@/lib/calc/aggregate';
import { laborCostSplit, EMPTY_LABOR_COST_CONTEXT, type LaborCostLine } from '@/lib/calc/labor-cost';
import { DEFAULT_LABOR_RULE, laborLineValues, reportTotals } from '@/lib/calc/report';
import {
  applyUnnamedCompanies,
  isUnnamedLabor,
  laborDisplayName,
  laborHeadcount,
  UNNAMED_SAFETY_NOTE,
  unnamedCompanyChoices,
  unnamedCompanyIds,
  unnamedWorkerName,
  UNNAMED_NOT_PARTNER_MESSAGE,
} from '@/lib/report/unnamed-workers';
import { validateReport, reportWarnings, type SaveInput } from '@/lib/report/schema';
import { toLineRow, fromLineRow, copyableLines } from '@/lib/report/rows';
import { applyMasterSnapshots, EMPTY_SNAPSHOT_MASTERS } from '@/lib/report/snapshots';
import type { LaborLine, TimeSpec } from '@/lib/types';

// 名前なし（会社と人数）の作業員の行（2026-11-19）。

const common: TimeSpec = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 }; // 実働 8H
const rule = DEFAULT_LABOR_RULE;
const TOHOKU = '11111111-1111-4111-8111-111111111111';

function unnamed(headcount: number | null, patch: Partial<LaborLine> = {}): LaborLine {
  return {
    kind: 'labor',
    workerId: null,
    workerName: '東北建興（名前なし）',
    time: { start: null, end: null, breakMin: null, gapMin: null },
    dailyRate: 20000,
    note: '',
    overtimeRate: null,
    affiliation: 'partner',
    supplierId: TOHOKU,
    laborContract: 'jouyou',
    jouyouHours: null,
    headcount,
    ...patch,
  };
}

describe('名前なしの行の判定・人数・表示名', () => {
  it('headcount が入っていれば名前なしの行（0 は入力途中）', () => {
    expect(isUnnamedLabor({ headcount: 2 })).toBe(true);
    expect(isUnnamedLabor({ headcount: 0 })).toBe(true);
    expect(isUnnamedLabor({ headcount: null })).toBe(false);
    expect(isUnnamedLabor({})).toBe(false);
  });
  it('計算に使う人数：null・省略・1 未満・数でないものは 1 人', () => {
    expect(laborHeadcount({ headcount: 3 })).toBe(3);
    expect(laborHeadcount({ headcount: null })).toBe(1);
    expect(laborHeadcount({})).toBe(1);
    expect(laborHeadcount({ headcount: 0 })).toBe(1);
    expect(laborHeadcount({ headcount: Number.NaN })).toBe(1);
  });
  it('名前：会社名（名前なし）。会社名が無ければ 協力会社（名前なし）', () => {
    expect(unnamedWorkerName('東北建興')).toBe('東北建興（名前なし）');
    expect(unnamedWorkerName('')).toBe('協力会社（名前なし）');
  });
  it('出面の表示：名前なしの行は「東北建興（名前なし）2名」、名前のある行はそのまま', () => {
    expect(laborDisplayName({ workerName: '東北建興（名前なし）', headcount: 2 })).toBe('東北建興（名前なし）2名');
    expect(laborDisplayName({ workerName: '山田', headcount: null })).toBe('山田');
    expect(laborDisplayName({ workerName: '山田' })).toBe('山田');
  });
  it('安全管理の知らせの文言', () => {
    expect(UNNAMED_SAFETY_NOTE).toBe('作業した人の名前が分かったら入れてください（安全管理）');
  });
});

describe('人工・残業・労務費は人数分', () => {
  it('2名 × 8H → 2.0 人工、労務費 40,000 円、実働は 1 人あたり 8H', () => {
    const v = laborLineValues(unnamed(2), common, rule);
    expect(v.hours).toBe(8);
    expect(v.manDays).toBe(2);
    expect(v.cost).toBe(40000);
    expect(v.headcount).toBe(2);
  });
  it('3名 × 4H → 1 人 0.53 人工 × 3 = 1.59 人工', () => {
    const v = laborLineValues(unnamed(3, { time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 } }), common, rule);
    expect(v.manDays).toBe(1.59);
    expect(v.cost).toBe(31800);
  });
  it('残業も人数分：2名 × 9H（残業 1H、残業単価 3,125）→ 残業 2H、労務費 2 × 20,000 ＋ 2 × 3,125', () => {
    const v = laborLineValues(unnamed(2, { time: { start: '08:00', end: '18:00', breakMin: 60, gapMin: 0 } }), common, rule);
    expect(v.overtimeHours).toBe(2);
    expect(v.cost).toBe(46250);
  });
  it('名前のある行（headcount なし）は今までどおり 1 人', () => {
    const v = laborLineValues(unnamed(null, { workerName: '山田' }), common, rule);
    expect(v.manDays).toBe(1);
    expect(v.headcount).toBe(1);
  });
  it('日報の集計：人数・実働・人工は人数分', () => {
    const t = reportTotals([unnamed(2), unnamed(null, { workerName: '山田' })], common, rule);
    expect(t.workerCount).toBe(3);
    expect(t.manDays).toBe(3);
    expect(t.laborHours).toBe(24);
  });
});

describe('労務費の決まり（請負の行のうち常用の時間は 1 人あたり）', () => {
  const line = (headcount: number | null, opts: { manDays: number; overtimeHours?: number; hours?: number; jouyouHours: number }): LaborCostLine => ({
    affiliation: 'partner',
    supplierId: TOHOKU,
    laborContract: 'ukeoi',
    jouyouHours: opts.jouyouHours,
    dailyRate: 20000,
    overtimeRate: null,
    headcount,
    stored: { amount: 0, manDays: opts.manDays, overtimeHours: opts.overtimeHours ?? 0, hours: opts.hours ?? 8 },
  });
  it('請負 2名 × 8H、うち常用 4H → 常用 1.0 人工・請負 1.0 人工', () => {
    const s = laborCostSplit(line(2, { manDays: 2, jouyouHours: 4 }), EMPTY_LABOR_COST_CONTEXT);
    expect(s.jouyouManDays).toBe(1);
    expect(s.ukeoiManDays).toBe(1);
    expect(s.countedCost).toBe(20000);
  });
  it('請負 2名 × 10H（残業 2H × 2 人＝4H）、うち常用 10H → 常用の残業は 1 人 2H × 2 人 = 4H', () => {
    const s = laborCostSplit(line(2, { manDays: 2, overtimeHours: 4, hours: 10, jouyouHours: 10 }), EMPTY_LABOR_COST_CONTEXT);
    expect(s.jouyouOvertimeHours).toBe(4);
    expect(s.countedCost).toBe(2 * 20000 + 4 * 3125);
  });
  it('請負 2名、うち常用 1H（残業 1 人 2H）→ 常用の残業は 1 人 1H × 2 人 = 2H', () => {
    const s = laborCostSplit(line(2, { manDays: 2, overtimeHours: 4, hours: 10, jouyouHours: 1 }), EMPTY_LABOR_COST_CONTEXT);
    expect(s.jouyouOvertimeHours).toBe(2);
  });
  it('人数なし（1 人）は今までどおり', () => {
    const s = laborCostSplit(line(null, { manDays: 1, overtimeHours: 2, hours: 10, jouyouHours: 1 }), EMPTY_LABOR_COST_CONTEXT);
    expect(s.jouyouOvertimeHours).toBe(1);
  });
});

describe('入力の検証', () => {
  const input = (lines: LaborLine[]): SaveInput => ({
    siteId: '22222222-2222-4222-8222-222222222222',
    date: '2026-11-19',
    weather: null,
    supervisor: null,
    common,
    issuesText: '',
    notesText: '',
    lines,
  });
  it('会社と人数が入っていれば通り、会社（supplierId）と人数が残る', () => {
    const r = validateReport(input([unnamed(2)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.value.lines[0] as LaborLine;
    expect(l.headcount).toBe(2);
    expect(l.supplierId).toBe(TOHOKU);
  });
  it('人数が 0（空欄）・小数・負は止める', () => {
    for (const h of [0, 1.5, -1]) {
      const r = validateReport(input([unnamed(h)]));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]).toBe('作業員の1行目：人数は1以上の整数で入れてください');
    }
  });
  it('会社を選んでいなければ止める', () => {
    const r = validateReport(input([unnamed(2, { supplierId: null, workerName: '（名前なし）' })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe('作業員の1行目：名前なしの行は会社を選んでください');
  });
  it('名前のある行に送られた会社（supplierId）は取り除く（所属はサーバーが決める）', () => {
    const r = validateReport(input([unnamed(null, { workerName: '山田' })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value.lines[0] as LaborLine).supplierId).toBeUndefined();
  });
  it('警告：日当の未設定・うち常用の時間の超過は表示名で出す', () => {
    const w = reportWarnings(input([unnamed(2, { dailyRate: null, laborContract: 'ukeoi', jouyouHours: 9 })]));
    expect(w).toContain('作業員「東北建興（名前なし）2名」：うち常用の時間がありますが、常用の単価（日当）が未設定です');
    expect(w.some((x) => x.startsWith('作業員「東北建興（名前なし）2名」：うち常用の時間（'))).toBe(true);
    expect(reportWarnings(input([unnamed(2, { dailyRate: null })]))).toContain('作業員「東北建興（名前なし）2名」：日当が未設定です（労務費が0円になります）');
  });
  it('請負の行は原価 0 が決まり：うち常用の時間が空なら日当の未設定を知らせない（名前あり・名前なし）', () => {
    const named = unnamed(null, { workerName: '佐藤', dailyRate: null, laborContract: 'ukeoi', jouyouHours: null });
    const w = reportWarnings(input([unnamed(1, { dailyRate: null, laborContract: 'ukeoi', jouyouHours: null }), named]));
    expect(w.filter((x) => x.includes('日当'))).toEqual([]);
  });
  it('請負の行でうち常用の時間があれば、日当も実行予算の常用の単価も無いときだけ知らせる', () => {
    const l = unnamed(1, { dailyRate: null, laborContract: 'ukeoi', jouyouHours: 4 });
    const msg = '作業員「東北建興（名前なし）1名」：うち常用の時間がありますが、常用の単価（日当）が未設定です';
    expect(reportWarnings(input([l]))).toContain(msg);
    const ctx = { siteStartDate: null, today: '2026-12-31', jouyouRates: { [TOHOKU]: 25000 } };
    expect(reportWarnings(input([l]), ctx)).not.toContain(msg);
    expect(reportWarnings(input([{ ...l, dailyRate: 22000 }]))).not.toContain(msg);
  });
});

describe('保存の行・読み取り・前回コピー', () => {
  it('toLineRow：人数・会社・所属を書き、人工・金額は人数分', () => {
    const r = toLineRow(unnamed(2), common, 0, rule);
    expect(r.headcount).toBe(2);
    expect(r.ref_id).toBeNull();
    expect(r.supplier_id).toBe(TOHOKU);
    expect(r.affiliation).toBe('partner');
    expect(r.man_days).toBe(2);
    expect(r.amount).toBe(40000);
    expect(r.hours).toBe(8);
  });
  it('toLineRow：名前のある行・労務以外の行の人数は null', () => {
    expect(toLineRow(unnamed(null, { workerName: '山田' }), common, 0, rule).headcount).toBeNull();
  });
  it('fromLineRow：人数の列を読む（列が無い・null は null）', () => {
    expect((fromLineRow({ kind: 'labor', name: '東北建興（名前なし）', headcount: '2' }) as LaborLine).headcount).toBe(2);
    expect((fromLineRow({ kind: 'labor', name: '山田' }) as LaborLine).headcount).toBeUndefined();
  });
  it('前回コピー：名前なしの行は会社・人数・区分を残し、時間とうち常用の時間を空にする', () => {
    const [c] = copyableLines([{ ...unnamed(2, { laborContract: 'ukeoi', jouyouHours: 3 }), time: common }]) as LaborLine[];
    expect(c.headcount).toBe(2);
    expect(c.supplierId).toBe(TOHOKU);
    expect(c.laborContract).toBe('ukeoi');
    expect(c.jouyouHours).toBeNull();
    expect(c.time.start).toBeNull();
  });
});

describe('保存時の所属（snapshots）', () => {
  it('名前なしの行：所属は協力会社・会社は選んだ会社・区分は既定で常用', () => {
    const [l] = applyMasterSnapshots([unnamed(2, { laborContract: undefined, affiliation: null })], '2026-11-19', EMPTY_SNAPSHOT_MASTERS) as LaborLine[];
    expect(l.affiliation).toBe('partner');
    expect(l.supplierId).toBe(TOHOKU);
    expect(l.laborContract).toBe('jouyou');
    expect(l.headcount).toBe(2);
  });
  it('名前なしの請負の行はうち常用の時間を残す・常用の行は消す', () => {
    const [u] = applyMasterSnapshots([unnamed(2, { laborContract: 'ukeoi', jouyouHours: 4 })], '2026-11-19', EMPTY_SNAPSHOT_MASTERS) as LaborLine[];
    expect(u.jouyouHours).toBe(4);
    const [j] = applyMasterSnapshots([unnamed(2, { laborContract: 'jouyou', jouyouHours: 4 })], '2026-11-19', EMPTY_SNAPSHOT_MASTERS) as LaborLine[];
    expect(j.jouyouHours).toBeNull();
  });
  it('作業員を選んだ行・手入力の行に人数が来ても消す', () => {
    const [m] = applyMasterSnapshots([unnamed(2, { workerId: '33333333-3333-4333-8333-333333333333', workerName: '山田' })], '2026-11-19', EMPTY_SNAPSHOT_MASTERS) as LaborLine[];
    expect(m.headcount ?? null).toBeNull();
  });
});

describe('会社の選択肢', () => {
  const suppliers = [
    { id: 'a', name: 'い工業', active: true, isPartner: true },
    { id: 'b', name: 'あ建興', active: true, isPartner: true },
    { id: 'c', name: '材料屋', active: true, isPartner: false },
    { id: 'd', name: 'う組', active: false, isPartner: true },
    { id: 'e', name: 'え組', active: true, isPartner: true },
  ];
  it('現場に関わる協力会社（現場の協力会社・作業員の会社・請負の会社）だけ、名前順', () => {
    const r = unnamedCompanyChoices({ suppliers, siteCompanyIds: ['a', 'b', 'c'], usedIds: new Set() });
    expect(r.map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('現場に関わる会社が無ければ有効な協力会社全部', () => {
    const r = unnamedCompanyChoices({ suppliers, siteCompanyIds: [], usedIds: new Set() });
    expect(r.map((s) => s.id)).toEqual(['b', 'a', 'e']);
  });
  it('この日報で使っている会社は無効でも残す', () => {
    const r = unnamedCompanyChoices({ suppliers, siteCompanyIds: ['a'], usedIds: new Set(['d']) });
    expect(r.map((s) => s.id)).toEqual(['a', 'd']);
  });
});

describe('保存のときの会社の確認と名前', () => {
  const companies = new Map([
    [TOHOKU, { name: '東北建興', isPartner: true }],
    ['vendor', { name: '材料屋', isPartner: false }],
  ]);
  it('協力会社なら名前を「会社名（名前なし）」に付け直す', () => {
    const r = applyUnnamedCompanies([unnamed(2, { workerName: '古い名前（名前なし）' })], companies, new Set());
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.lines[0] as LaborLine).workerName).toBe('東北建興（名前なし）');
  });
  it('協力会社でない・見つからない会社は止める', () => {
    expect(applyUnnamedCompanies([unnamed(2, { supplierId: 'vendor' })], companies, new Set())).toEqual({ ok: false, error: UNNAMED_NOT_PARTNER_MESSAGE });
    expect(applyUnnamedCompanies([unnamed(2, { supplierId: 'none' })], companies, new Set()).ok).toBe(false);
  });
  it('この日報ですでに使っている会社は印が無くても保存し直せる', () => {
    expect(applyUnnamedCompanies([unnamed(2, { supplierId: 'vendor' })], companies, new Set(['vendor'])).ok).toBe(true);
  });
  it('名前のある行はそのまま。会社の ID は名前なしの行だけ', () => {
    const named = unnamed(null, { workerName: '山田' });
    const r = applyUnnamedCompanies([named], companies, new Set());
    expect(r.ok && r.lines[0]).toBe(named);
    expect(unnamedCompanyIds([named, unnamed(2), unnamed(3)])).toEqual([TOHOKU]);
  });
});

describe('出面一覧・作業員別累計', () => {
  const e = (date: string, headcount: number | null, name = '東北建興（名前なし）') => ({
    reportDate: date, workerId: null, workerName: name, manDays: headcount ?? 1, cost: 20000 * (headcount ?? 1), overtimeHours: 0, headcount,
  });
  it('名前なしの行は会社ごとに「会社名（名前なし）」の 1 行、日ごとの人数を持つ', () => {
    const rows = attendance([e('2026-11-02', 2), e('2026-11-03', 3), e('2026-11-02', null, '山田')]);
    const u = rows.find((r) => r.workerName === '東北建興（名前なし）')!;
    expect(u.unnamed).toBe(true);
    expect(u.byDate['2026-11-02']).toEqual({ manDays: 2, cost: 40000, headcount: 2 });
    expect(u.manDays).toBe(5);
    expect(rows.find((r) => r.workerName === '山田')!.unnamed).toBe(false);
  });
  it('作業員別累計：会社ごとにまとめ、人工は人数分', () => {
    const rows = workerCumulative([e('2026-11-02', 2), e('2026-11-03', 3)], [], {}, { from: null, to: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workerName: '東北建興（名前なし）', totalManDays: 5, workDays: 2 });
  });
});
