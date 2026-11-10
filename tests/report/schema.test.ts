import { describe, it, expect } from 'vitest';
import { validateReport, reportWarnings, type SaveInput } from '@/lib/report/schema';
const base = { siteId: '11111111-1111-1111-1111-111111111111', date: '2026-11-05', weather: '晴れ', supervisor: '大堀', common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 }, issuesText: '', notesText: '', lines: [] as any[] };
describe('validateReport', () => {
  it('作業員名が空の労務行はエラー', () => {
    const r = validateReport({ ...base, lines: [{ kind: 'labor', workerId: null, workerName: '', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '' }] });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors[0]).toContain('作業員名');
  });
  it('燃料行は車両・走行距離・燃料単価が必須', () => {
    const r = validateReport({ ...base, lines: [{ kind: 'fuel', vehicleId: null, vehicleName: 'ハイエース', kmPerL: 10, distanceKm: null, pricePerL: 170, note: '' }] });
    expect(r.ok).toBe(false);
  });
  it('日付形式が違えばエラー', () => expect(validateReport({ ...base, date: '2026/11/05' }).ok).toBe(false));
});
describe('reportWarnings', () => {
  it('終了が開始より前・燃費未設定・日当未設定・作業員0行を警告する', () => {
    const w = reportWarnings({ ...base, lines: [
      { kind: 'labor', workerId: 'w', workerName: '田中', time: { start: '17:00', end: '08:00', breakMin: 0, gapMin: 0 }, dailyRate: null, note: '', overtimeRate: null },
      { kind: 'fuel', vehicleId: 'v', vehicleName: 'ダンプ', kmPerL: null, distanceKm: 20, pricePerL: 170, note: '', issueId: null },
    ] });
    expect(w.some(s => s.includes('終了が開始より前'))).toBe(true);
    expect(w.some(s => s.includes('燃費が未設定'))).toBe(true);
    expect(w.some(s => s.includes('日当が未設定'))).toBe(true);
    expect(reportWarnings({ ...base, lines: [] }).some(s => s.includes('作業員が0'))).toBe(true);
  });
  it('着工予定日より前・今日より後の日付を警告する', () => {
    const w1 = reportWarnings(base, { siteStartDate: '2026-11-10', today: '2026-11-20' });
    expect(w1.some(s => s.includes('着工予定日より前'))).toBe(true);
    const w2 = reportWarnings(base, { siteStartDate: '2026-10-01', today: '2026-11-01' });
    expect(w2.some(s => s.includes('今日より後'))).toBe(true);
  });
});

describe('労務の行の常用・請負（laborContract）', () => {
  const labor = (extra: Record<string, unknown>) => ({
    kind: 'labor', workerId: null, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '', ...extra,
  });
  it("'jouyou'・'ukeoi' を受け取る。空欄は null、省略（古い下書き）は無いまま", () => {
    const r = validateReport({ ...base, lines: [labor({ laborContract: 'jouyou' }), labor({ laborContract: 'ukeoi' }), labor({ laborContract: '' }), labor({})] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines.map((l) => (l.kind === 'labor' ? l.laborContract : 'x'))).toEqual(['jouyou', 'ukeoi', null, undefined]);
  });
  it('それ以外の値はエラー', () => {
    const r = validateReport({ ...base, lines: [labor({ laborContract: 'haken' })] });
    expect(r).toEqual({ ok: false, errors: ['作業員の1行目：常用・請負の区分が正しくありません'] });
  });
  it('所属（affiliation・supplierId）は画面から受け取らない（保存時にサーバーがマスターから写す）', () => {
    const r = validateReport({ ...base, lines: [labor({ affiliation: 'partner', supplierId: '22222222-2222-4222-8222-222222222222' })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines[0]).not.toHaveProperty('affiliation');
    expect(r.value.lines[0]).not.toHaveProperty('supplierId');
  });
});

describe('作業内容の行の実行予算の工種（siteTradeId）', () => {
  const work = (extra: Record<string, unknown>) => ({
    kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 1, unit: '㎡', manDays: 1, unitPrice: null, source: 'extra', ...extra,
  });
  const T = '44444444-4444-4444-8444-444444444444';
  it('工種の id はそのまま、空欄・省略（古い下書き）は null', () => {
    const r = validateReport({ ...base, lines: [work({ siteTradeId: T }), work({ siteTradeId: '' }), work({})] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines.map((l) => (l.kind === 'work' ? l.siteTradeId : 'x'))).toEqual([T, null, null]);
  });
  it('id の形でなければエラー', () => {
    expect(validateReport({ ...base, lines: [work({ siteTradeId: 'abc' })] }).ok).toBe(false);
  });
});

describe('買掛の区分・工種・根拠、現金・リース・燃料の根拠（2026-11-17）', () => {
  const T = '44444444-4444-4444-8444-444444444444';
  const credit = (extra: Record<string, unknown>) => ({
    kind: 'credit', itemName: 'タイル工事', spec: '', unit: '式', qty: 1, unitPrice: 100000, supplierId: null, vendor: '東北建興', ...extra,
  });
  it('古い下書き（区分などが無い）は仕入・工種なし・根拠なし', () => {
    const r = validateReport({ ...base, lines: [
      credit({}),
      { kind: 'cash', itemName: '釘', spec: '', unit: '', qty: 1, unitPrice: 100, vendor: '' },
      { kind: 'lease', itemId: null, itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 100, note: '' },
      { kind: 'fuel', vehicleId: null, vehicleName: 'ダンプ', kmPerL: 5, distanceKm: 10, pricePerL: 170, note: '' },
    ] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines[0]).toMatchObject({ purchaseKind: 'material', siteTradeId: null, issueId: null });
    for (const l of r.value.lines.slice(1)) expect(l).toMatchObject({ issueId: null });
  });
  it('外注・工種・根拠をそのまま受け取る。想定外の区分はエラー', () => {
    const r = validateReport({ ...base, lines: [credit({ purchaseKind: 'subcontract', siteTradeId: T, issueId: T })] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.lines[0]).toMatchObject({ purchaseKind: 'subcontract', siteTradeId: T, issueId: T });
    expect(validateReport({ ...base, lines: [credit({ purchaseKind: 'other' })] }).ok).toBe(false);
  });
  it('買掛の単価が負なら「単価は0以上」、支払先の文言', () => {
    const r = validateReport({ ...base, lines: [credit({ unitPrice: -1 })] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe('買掛の1行目：単価は0以上の数値で入力してください');
    const v = validateReport({ ...base, lines: [credit({ vendor: 'あ'.repeat(201) })] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toContain('支払先は200文字以内');
  });
  it('外注で工種を選んでいない行は警告（工種のある現場だけ）', () => {
    const input = { ...base, lines: [credit({ purchaseKind: 'subcontract', siteTradeId: null, issueId: null })] } as SaveInput;
    expect(reportWarnings(input).some((s) => s.includes('外注「タイル工事」：工種が選ばれていません'))).toBe(true);
    expect(reportWarnings(input, { siteStartDate: null, today: '2026-11-05', siteHasTrades: false }).some((s) => s.includes('工種が選ばれていません'))).toBe(false);
    const ok = { ...base, lines: [credit({ purchaseKind: 'subcontract', siteTradeId: T, issueId: null })] } as SaveInput;
    expect(reportWarnings(ok).some((s) => s.includes('工種が選ばれていません'))).toBe(false);
  });
});

describe('作業員のうち常用の時間（2026-11-17）', () => {
  const labor = (extra: Record<string, unknown>) => ({
    kind: 'labor', workerId: null, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '', ...extra,
  });
  it('数値・空欄（null）・省略（null）を受け取る。負・24 超はエラー', () => {
    const r = validateReport({ ...base, lines: [labor({ jouyouHours: 4 }), labor({ jouyouHours: '' }), labor({})] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.lines.map((l) => (l as { jouyouHours?: unknown }).jouyouHours)).toEqual([4, null, null]);
    expect(validateReport({ ...base, lines: [labor({ jouyouHours: -1 })] }).ok).toBe(false);
    expect(validateReport({ ...base, lines: [labor({ jouyouHours: 25 })] }).ok).toBe(false);
  });
});
