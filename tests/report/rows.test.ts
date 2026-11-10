import { describe, expect, it } from 'vitest';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { copyableLines, fromLineRow, saveErrorMessage, toLineRow, toLineRows, toReportRow, withoutSaved } from '@/lib/report/rows';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { CreditLine, LaborLine, ReportLine, TimeSpec, WorkLine } from '@/lib/types';

const common: TimeSpec = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };
const W = '11111111-1111-4111-8111-111111111111';
const lines: ReportLine[] = [
  { kind: 'labor', workerId: W, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 19000, note: '', overtimeRate: null, laborContract: null, affiliation: 'own', supplierId: null, jouyouHours: null },
  { kind: 'fuel', vehicleId: W, vehicleName: 'ハイエース', kmPerL: 10, distanceKm: 40, pricePerL: 170, note: '給油', issueId: null },
  { kind: 'lease', itemId: W, itemName: '足場材', spec: '', unit: '式', qty: 1, unitPrice: 3500, note: '', issueId: null },
  { kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: 'ホームセンター', issueId: null },
  { kind: 'credit', itemName: 'タイル', spec: '300角', unit: '枚', qty: 50, unitPrice: 250, supplierId: W, vendor: 'ABC建材', purchaseKind: 'material', siteTradeId: null, issueId: null },
  { kind: 'work', estimateItemId: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', manDays: 1.6, unitPrice: 1200, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null },
];

describe('toLineRows', () => {
  const rows = toLineRows(lines, common, DEFAULT_LABOR_RULE);
  it('全行が38列ぶんのキーを持ち、空値は null（"" を送らない）', () => {
    for (const r of rows) {
      expect(Object.keys(r)).toHaveLength(38);
      expect(Object.values(r)).not.toContain('');
    }
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('労務: ref_id=作業員、unit_price=日当、計算値をサーバーで入れる', () => {
    expect(rows[0]).toMatchObject({
      kind: 'labor', ref_id: W, name: '田中', start_time: null, end_time: null, break_min: null, gap_min: null,
      hours: 8, man_days: 1, unit_price: 19000, amount: 19000, note: null, overtime_hours: 0, overtime_rate: null,
    });
  });
  it('労務: 残業時間と残業単価（0 は null で送る）。労務以外は null', () => {
    const labor = lines[0] as LaborLine;
    const nine = { ...labor, time: { start: '08:00', end: '18:00', breakMin: null, gapMin: null } }; // 共通の休憩60 → 9H
    expect(toLineRow({ ...nine, overtimeRate: 3000 }, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({
      hours: 9, man_days: 1, overtime_hours: 1, overtime_rate: 3000, amount: 19000 + 3000,
    });
    expect(toLineRow({ ...nine, overtimeRate: 0 }, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({
      overtime_hours: 1, overtime_rate: null, amount: 19000 + 2969, // ROUND(19000 ÷ 8 × 1.25) = 2969
    });
    for (const r of rows.slice(1)) expect(r).toMatchObject({ overtime_hours: null, overtime_rate: null });
  });
  it('燃料・リース・現金・買掛・作業内容の列対応', () => {
    expect(rows[1]).toMatchObject({ ref_id: W, name: 'ハイエース', km_per_l: 10, distance_km: 40, price_per_l: 170, amount: 680, note: '給油' });
    expect(rows[2]).toMatchObject({ ref_id: W, name: '足場材', spec: null, unit: '式', qty: 1, unit_price: 3500, amount: 3500 });
    expect(rows[3]).toMatchObject({ ref_id: null, name: '養生テープ', unit: '巻', qty: 5, unit_price: 280, amount: 1400, vendor: 'ホームセンター' });
    expect(rows[4]).toMatchObject({ ref_id: W, name: 'タイル', spec: '300角', qty: 50, unit_price: 250, amount: 12500, vendor: 'ABC建材' });
    expect(rows[5]).toMatchObject({
      ref_id: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', man_days: 1.6, unit_price: 1200,
      amount: 42000, productivity: 21.875, source: 'extra', name: null,
      change_kind: 'contract', instructed_by: null, instruction_method: null, instructed_on: null, issue_id: null,
    });
  });
  it('区分・指示の列は作業内容の行だけ。その他の行は null（DB は区分を契約内にする）', () => {
    for (const r of rows.slice(0, 5)) {
      expect(r).toMatchObject({ change_kind: null, instructed_by: null, instruction_method: null, instructed_on: null, issue_id: null });
    }
  });
  it('買掛の区分は買掛の行だけ、うち常用の時間は作業員の行だけ（それ以外は null）', () => {
    expect(rows[4]).toMatchObject({ purchase_kind: 'material' });
    expect(rows[0]).toMatchObject({ jouyou_hours: null });
    for (const r of [rows[0], rows[1], rows[2], rows[3], rows[5]]) expect(r.purchase_kind).toBeNull();
    for (const r of rows.slice(1)) expect(r.jouyou_hours).toBeNull();
  });
  it('読み戻すと元の明細になる（空文字は "" に戻る。労務行は DB の計算値 saved も付く）', () => {
    const back = rows.map((r) => fromLineRow(r));
    expect(back.map((l) => (l?.kind === 'labor' ? withoutSaved(l) : l))).toEqual(lines);
    expect(back[0]).toMatchObject({ saved: { hours: 8, manDays: 1, overtimeHours: 0, cost: 19000 } });
    expect(fromLineRow({ kind: 'lease', qty: '2', unit_price: '3500.00' })).toMatchObject({ qty: 2, unitPrice: 3500 });
    expect(fromLineRow({ kind: 'labor', overtime_rate: '3000' })).toMatchObject({ overtimeRate: 3000 });
    expect(fromLineRow({ kind: 'labor', overtime_rate: null })).toMatchObject({ overtimeRate: null });
  });
  it('労務の saved は DB の文字列の数値から作り、実働・人工・金額のどれかが null なら付けない。保存の列には送らない', () => {
    const r = { kind: 'labor' as const, hours: '8.5', man_days: '1', overtime_hours: '0.5', amount: '19406.5' };
    expect(fromLineRow(r)).toMatchObject({ saved: { hours: 8.5, manDays: 1, overtimeHours: 0.5, cost: 19406.5 } });
    // 移行前に保存された行（残業列が無い）は残業 0 とみなして saved を付ける
    expect(fromLineRow({ ...r, overtime_hours: null })).toMatchObject({ saved: { hours: 8.5, manDays: 1, overtimeHours: 0, cost: 19406.5 } });
    expect(fromLineRow({ ...r, amount: null })).not.toHaveProperty('saved');
    const withSaved = fromLineRow(r) as LaborLine;
    expect(Object.keys(toLineRow(withSaved, common, 0, DEFAULT_LABOR_RULE))).not.toContain('saved');
    expect(copyableLines([withSaved])[0]).not.toHaveProperty('saved');
  });
});

describe('作業内容の行の実行予算の工種（site_trade_id）', () => {
  const T = '44444444-4444-4444-8444-444444444444';
  const work = lines[5] as WorkLine;
  it('選んだ工種は site_trade_id で送り、読み戻すと siteTradeId に残る', () => {
    const row = toLineRow({ ...work, siteTradeId: T }, common, 0, DEFAULT_LABOR_RULE);
    expect(row.site_trade_id).toBe(T);
    expect(fromLineRow(row)).toEqual({ ...work, siteTradeId: T });
  });
  it('選んでいない行は null。作業内容以外の行も null', () => {
    const rows = toLineRows(lines, common, DEFAULT_LABOR_RULE);
    for (const r of rows) expect(r.site_trade_id).toBeNull();
    expect(fromLineRow(rows[5])).toMatchObject({ siteTradeId: null });
  });
  it('列の無い・移行前の行は工種を選んでいない（null）', () => {
    expect(fromLineRow({ kind: 'work', description: '片付け' })).toMatchObject({ siteTradeId: null });
    expect(fromLineRow({ kind: 'work', description: '片付け', site_trade_id: '' })).toMatchObject({ siteTradeId: null });
  });
});

describe('作業内容の区分・指示（追加・増・変更・減の記録）', () => {
  const ISSUE = '22222222-2222-4222-8222-222222222222';
  const work: WorkLine = {
    ...(lines[5] as WorkLine),
    changeKind: 'extra', instructedBy: ' 施主 山田様 ', instructionMethod: 'phone', instructedOn: '2026-11-04', issueId: ISSUE,
  };
  it('保存の列に書き、読み戻すと同じ値になる（指示者の前後の空白は除く）', () => {
    const row = toLineRow(work, common, 0, DEFAULT_LABOR_RULE);
    expect(row).toMatchObject({
      change_kind: 'extra', instructed_by: '施主 山田様', instruction_method: 'phone', instructed_on: '2026-11-04', issue_id: ISSUE,
    });
    expect(fromLineRow(row)).toEqual({ ...work, instructedBy: '施主 山田様' });
  });
  it('列の無い・空の・正しくない値は既定（契約内・指示なし）で読む', () => {
    expect(fromLineRow({ kind: 'work', description: '片付け' })).toMatchObject(EMPTY_WORK_CHANGE);
    expect(
      fromLineRow({ kind: 'work', change_kind: 'plus', instructed_by: null, instruction_method: 'fax', instructed_on: '', issue_id: '' }),
    ).toMatchObject(EMPTY_WORK_CHANGE);
    for (const k of ['contract', 'extra', 'increase', 'change', 'minus'] as const) {
      expect(fromLineRow({ kind: 'work', change_kind: k })).toMatchObject({ changeKind: k });
    }
  });
  it('読み戻した作業内容の項目の並びは新しい行（区分などは末尾）と同じ', () => {
    expect(Object.keys(fromLineRow({ kind: 'work' }) as WorkLine).slice(-7)).toEqual([
      'source', 'changeKind', 'instructedBy', 'instructionMethod', 'instructedOn', 'issueId', 'siteTradeId',
    ]);
  });
});

describe('toReportRow', () => {
  it('空文字は null にして送る', () => {
    expect(
      toReportRow({ siteId: W, date: '2026-11-05', weather: '', supervisor: '大堀', common: { start: null, end: null, breakMin: null, gapMin: null }, issuesText: '', notesText: 'メモ', lines: [] }),
    ).toEqual({
      site_id: W, report_date: '2026-11-05', weather: null, supervisor: '大堀', common_start: null, common_end: null,
      common_break_min: null, common_gap_min: null, issues_text: null, notes_text: 'メモ',
    });
  });
});

describe('copyableLines', () => {
  it('作業員・車両・リースのみ。個別時間と走行距離は空、リース数量と残業単価は残す', () => {
    const withTime: ReportLine[] = [
      { ...(lines[0] as LaborLine), time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 }, overtimeRate: 3000 },
      ...lines.slice(1),
    ];
    const c = copyableLines(withTime);
    expect(c.map((l) => l.kind)).toEqual(['labor', 'fuel', 'lease']);
    expect(c[0]).toMatchObject({ time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 19000, overtimeRate: 3000 });
    expect(c[1]).toMatchObject({ distanceKm: null, kmPerL: 10, pricePerL: 170 });
    expect(c[2]).toMatchObject({ qty: 1 });
  });
});

describe('saveErrorMessage', () => {
  it('ガードの文言を日本語にする', () => {
    expect(saveErrorMessage('approved_report_locked')).toBe('承認済みのため編集できません');
    expect(saveErrorMessage('not_reviewer')).toBe('この現場の確認者・承認者ではありません');
    expect(saveErrorMessage('site_closed')).toBe('この現場は完了（または削除）されているため変更できません。管理者が進行中に戻すと入力できます。');
    expect(saveErrorMessage('stale_report')).toBe('他の端末で更新されています。画面を再読み込みしてから保存してください。');
    expect(saveErrorMessage('new row violates row-level security')).toContain('保存に失敗しました');
    expect(saveErrorMessage('trade_not_in_site')).toContain('工種がこの現場の実行予算にありません');
  });
});

describe('手入力の行の保存列', () => {
  it('作業員：ref_id は null、name は氏名、unit_price は日当（DB のトリガーがこの日当で労務費を計算する）', () => {
    const manual: LaborLine = { kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 15000, note: '', overtimeRate: null };
    expect(toLineRow(manual, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({
      kind: 'labor', ref_id: null, name: '飛び込み 鈴木', unit_price: 15000, hours: 8, man_days: 1, amount: 15000, overtime_rate: null,
    });
    // 残業単価は標準の計算式（日当 ÷ 8 × 1.25）：ROUND(15000 ÷ 8 × 1.25) = 2344
    const nine = { ...manual, time: { start: '08:00', end: '18:00', breakMin: null, gapMin: null } };
    expect(toLineRow(nine, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({ overtime_hours: 1, overtime_rate: null, amount: 15000 + 2344 });
  });
  it('買掛：ref_id は null、vendor は仕入先名', () => {
    const manual: ReportLine = { kind: 'credit', itemName: '砂', spec: '', unit: '袋', qty: 3, unitPrice: 500, supplierId: null, vendor: '近所の資材店', purchaseKind: 'material', siteTradeId: null, issueId: null };
    expect(toLineRow(manual, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({ kind: 'credit', ref_id: null, vendor: '近所の資材店', amount: 1500 });
  });
});

describe('労務の行の常用・請負と所属の写し（2026-11-07）', () => {
  const S = '22222222-2222-4222-8222-222222222222';
  const base = lines[0] as LaborLine;
  it('協力会社の行は labor_contract・affiliation・supplier_id を送り、読み戻すと同じ値になる', () => {
    const partner: LaborLine = { ...base, laborContract: 'ukeoi', affiliation: 'partner', supplierId: S };
    const row = toLineRow(partner, common, 0, DEFAULT_LABOR_RULE);
    expect(row).toMatchObject({ labor_contract: 'ukeoi', affiliation: 'partner', supplier_id: S });
    expect(withoutSaved(fromLineRow(row) as LaborLine)).toEqual(partner);
  });
  it('項目の無い労務の行（古い下書き）は null で送る。労務以外の行は常に null', () => {
    const { laborContract: _c, affiliation: _a, supplierId: _s, ...old } = base;
    void _c; void _a; void _s;
    expect(toLineRow(old, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({ labor_contract: null, affiliation: null, supplier_id: null });
    for (const r of toLineRows(lines, common, DEFAULT_LABOR_RULE).slice(1)) {
      expect(r).toMatchObject({ labor_contract: null, affiliation: null, supplier_id: null });
    }
  });
  it('移行前の行・知らない値は null（常用・所属なし）として読む', () => {
    expect(fromLineRow({ kind: 'labor' })).toMatchObject({ laborContract: null, affiliation: null, supplierId: null });
    expect(fromLineRow({ kind: 'labor', labor_contract: 'x' as never, affiliation: 'y' as never, supplier_id: '' })).toMatchObject({
      laborContract: null, affiliation: null, supplierId: null,
    });
    expect(fromLineRow({ kind: 'labor', labor_contract: 'jouyou', affiliation: 'own' })).toMatchObject({ laborContract: 'jouyou', affiliation: 'own' });
  });
});

describe('買掛の区分・工種・根拠（2026-11-17）', () => {
  const T = '44444444-4444-4444-8444-444444444444';
  const ISSUE = '22222222-2222-4222-8222-222222222222';
  const credit = lines[4] as CreditLine;
  it('外注の行は区分・工種・根拠が往復で残る', () => {
    const sub: CreditLine = { ...credit, purchaseKind: 'subcontract', siteTradeId: T, issueId: ISSUE };
    const row = toLineRow(sub, common, 0, DEFAULT_LABOR_RULE);
    expect(row).toMatchObject({ purchase_kind: 'subcontract', site_trade_id: T, issue_id: ISSUE });
    expect(fromLineRow(row)).toEqual(sub);
  });
  it('仕入の行の工種は送らない（null）。根拠は残る', () => {
    const row = toLineRow({ ...credit, siteTradeId: T, issueId: ISSUE }, common, 0, DEFAULT_LABOR_RULE);
    expect(row).toMatchObject({ purchase_kind: 'material', site_trade_id: null, issue_id: ISSUE });
    expect(fromLineRow(row)).toEqual({ ...credit, issueId: ISSUE });
  });
  it('列の無い古い行・null の区分は仕入（工種・根拠なし）', () => {
    expect(fromLineRow({ kind: 'credit', name: 'タイル' })).toMatchObject({ purchaseKind: 'material', siteTradeId: null, issueId: null });
    expect(fromLineRow({ kind: 'credit', purchase_kind: null, site_trade_id: T })).toMatchObject({ purchaseKind: 'material', siteTradeId: null });
    expect(fromLineRow({ kind: 'credit', purchase_kind: 'other' })).toMatchObject({ purchaseKind: 'material' });
  });
});

describe('現金・リース・燃料の根拠（2026-11-17）', () => {
  const ISSUE = '22222222-2222-4222-8222-222222222222';
  it('根拠の件が往復で残る', () => {
    for (const i of [1, 2, 3]) {
      const l = { ...lines[i], issueId: ISSUE } as ReportLine;
      const row = toLineRow(l, common, 0, DEFAULT_LABOR_RULE);
      expect(row.issue_id).toBe(ISSUE);
      expect(fromLineRow(row)).toEqual(l);
    }
  });
  it('作業員の行の issue_id は null', () => {
    expect(toLineRow(lines[0], common, 0, DEFAULT_LABOR_RULE).issue_id).toBeNull();
  });
});

describe('作業員のうち常用の時間（2026-11-17）', () => {
  const labor = lines[0] as LaborLine;
  it('4 時間が往復で残る。空は null', () => {
    const row = toLineRow({ ...labor, jouyouHours: 4 }, common, 0, DEFAULT_LABOR_RULE);
    expect(row.jouyou_hours).toBe(4);
    expect(fromLineRow(row)).toMatchObject({ jouyouHours: 4 });
    expect(toLineRow({ ...labor, jouyouHours: null }, common, 0, DEFAULT_LABOR_RULE).jouyou_hours).toBeNull();
    expect(fromLineRow({ kind: 'labor', jouyou_hours: '' })).toMatchObject({ jouyouHours: null });
    expect(fromLineRow({ kind: 'labor', jouyou_hours: '3.5' })).toMatchObject({ jouyouHours: 3.5 });
  });
  it('前回コピーでは空にする', () => {
    expect(copyableLines([{ ...labor, jouyouHours: 4 }])[0]).toMatchObject({ jouyouHours: null });
  });
});

describe('保存のエラーの文言（根拠の件）', () => {
  it('issue_not_in_site', () => {
    expect(saveErrorMessage('issue_not_in_site')).toBe('選んだ件がこの現場にありません。画面を再読み込みして選び直してください');
  });
});
