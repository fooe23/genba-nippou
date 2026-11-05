import { describe, it, expect } from 'vitest';
import { validateReport, reportWarnings } from '@/lib/report/schema';
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
      { kind: 'fuel', vehicleId: 'v', vehicleName: 'ダンプ', kmPerL: null, distanceKm: 20, pricePerL: 170, note: '' },
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
