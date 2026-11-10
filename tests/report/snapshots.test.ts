import { describe, expect, it } from 'vitest';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { fromLineRow, toLineRow } from '@/lib/report/rows';
import { applyMasterSnapshots, EMPTY_SNAPSHOT_MASTERS, needsMasterSnapshots } from '@/lib/report/snapshots';
import type { ReportLine } from '@/lib/types';

const W1 = '11111111-1111-4111-8111-111111111111';
const V1 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const masters = {
  workers: [{ id: W1, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }, { amount: 19000, effectiveFrom: '2026-11-01' }], overtimeRate: 3000, affiliation: 'own' as const, supplierId: null }],
  vehicles: [{ id: V1, kmPerL: 10 }],
  leaseItems: [{ id: L1, rates: [{ amount: 3500, effectiveFrom: '2026-04-01' }] }],
};
const t = { start: null, end: null, breakMin: null, gapMin: null };

describe('保存時のマスター単価の複写（サーバー側）', () => {
  const lines: ReportLine[] = [
    { kind: 'labor', workerId: W1, workerName: '田中', time: t, dailyRate: 999999, note: '', overtimeRate: 99999 },
    { kind: 'labor', workerId: null, workerName: '応援', time: t, dailyRate: 15000, note: '', overtimeRate: 2500 },
    { kind: 'labor', workerId: UNKNOWN, workerName: '偽', time: t, dailyRate: 999999, note: '', overtimeRate: 99999 },
    { kind: 'fuel', vehicleId: V1, vehicleName: 'ハイエース', kmPerL: 0.01, distanceKm: 40, pricePerL: 170, note: '', issueId: null },
    { kind: 'lease', itemId: L1, itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 1, note: '', issueId: null },
    { kind: 'lease', itemId: null, itemName: '手入力', spec: '', unit: '式', qty: 1, unitPrice: 800, note: '', issueId: null },
    { kind: 'cash', itemName: 'テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: '', issueId: null },
  ];
  it('参照のある行は日付に有効なマスターの値、参照の無い行はそのまま、存在しない参照は null', () => {
    const out = applyMasterSnapshots(lines, '2026-10-31', masters);
    expect(out[0]).toMatchObject({ dailyRate: 18000, overtimeRate: 3000 });
    expect(out[1]).toMatchObject({ dailyRate: 15000, overtimeRate: 2500 });
    expect(out[2]).toMatchObject({ dailyRate: null, overtimeRate: null });
    expect(out[3]).toMatchObject({ kmPerL: 10 });
    expect(out[4]).toMatchObject({ unitPrice: 3500 });
    expect(out[5]).toMatchObject({ unitPrice: 800 });
    expect(out[6]).toBe(lines[6]);
    expect(applyMasterSnapshots(lines, '2026-11-01', masters)[0]).toMatchObject({ dailyRate: 19000 });
    expect(applyMasterSnapshots(lines, '2026-03-31', masters)[4]).toMatchObject({ unitPrice: null });
  });
  it('作業員の残業単価が無い（null）ときは null（標準の計算式）にし、クライアントの値は使わない', () => {
    const noOvertime = { ...masters, workers: [{ ...masters.workers[0], overtimeRate: null }] };
    expect(applyMasterSnapshots(lines, '2026-10-31', noOvertime)[0]).toMatchObject({ dailyRate: 18000, overtimeRate: null });
  });
  it('手入力の作業員・仕入先の行（参照なし）は同じオブジェクトのまま返す', () => {
    const manual: ReportLine[] = [
      { kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time: t, dailyRate: 15000, note: '', overtimeRate: null },
      { kind: 'credit', itemName: '砂', spec: '', unit: '袋', qty: 3, unitPrice: 500, supplierId: null, vendor: '近所の資材店', purchaseKind: 'material', siteTradeId: null, issueId: null },
    ];
    const out = applyMasterSnapshots(manual, '2026-10-31', masters);
    expect(out[0]).toBe(manual[0]);
    expect(out[1]).toBe(manual[1]);
    expect(needsMasterSnapshots(manual)).toBe(false);
  });
  it('参照のある行が無ければマスターを読まなくてよい', () => {
    expect(needsMasterSnapshots(lines)).toBe(true);
    expect(needsMasterSnapshots([lines[1], lines[5], lines[6]])).toBe(false);
  });
});

describe('保存時の所属の写しと常用・請負（2026-11-07）', () => {
  const P = '44444444-4444-4444-8444-444444444444';
  const S = '55555555-5555-4555-8555-555555555555';
  const S2 = '66666666-6666-4666-8666-666666666666';
  const own = { id: W1, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }], overtimeRate: null, affiliation: 'own' as const, supplierId: null };
  const partner = { id: P, rates: [{ amount: 20000, effectiveFrom: '2026-01-01' }], overtimeRate: null, affiliation: 'partner' as const, supplierId: S };
  const m = { workers: [own, partner], vehicles: [], leaseItems: [] };
  const labor = (workerId: string | null, extra: Partial<ReportLine & { kind: 'labor' }> = {}): ReportLine => ({
    kind: 'labor', workerId, workerName: '作業員', time: t, dailyRate: 1, note: '', overtimeRate: null, ...extra,
  });
  it('マスターの所属を写す。画面から届いた所属は使わない', () => {
    const out = applyMasterSnapshots(
      [labor(W1, { affiliation: 'partner', supplierId: S2 }), labor(P, { affiliation: 'own', supplierId: null })],
      '2026-11-01',
      m,
    );
    expect(out[0]).toMatchObject({ affiliation: 'own', supplierId: null, laborContract: null });
    expect(out[1]).toMatchObject({ affiliation: 'partner', supplierId: S });
  });
  it('常用・請負は協力会社の行だけ（未選択は常用）。自社の行は null', () => {
    const out = applyMasterSnapshots([labor(P, { laborContract: 'ukeoi' }), labor(P), labor(W1, { laborContract: 'ukeoi' })], '2026-11-01', m);
    expect(out.map((l) => (l.kind === 'labor' ? l.laborContract : undefined))).toEqual(['ukeoi', 'jouyou', null]);
  });
  it('手入力の作業員・マスターに無い作業員は所属なし（null）・常用', () => {
    const hand = labor(null, { laborContract: 'ukeoi', affiliation: 'partner', supplierId: S });
    const out = applyMasterSnapshots([hand, labor(UNKNOWN, { affiliation: 'own' })], '2026-11-01', m);
    expect(out[0]).toMatchObject({ laborContract: null, affiliation: null, supplierId: null });
    expect(out[1]).toMatchObject({ laborContract: null, affiliation: null, supplierId: null, dailyRate: null });
    expect(applyMasterSnapshots([hand], '2026-11-01', EMPTY_SNAPSHOT_MASTERS)[0]).toMatchObject({ affiliation: null, laborContract: null });
  });
  it('保存し直し：この日報に保存済みの作業員は保存した所属のまま（後でマスターを変えても動かない）', () => {
    const saved = applyMasterSnapshots([labor(P, { laborContract: 'ukeoi' })], '2026-11-01', m);
    const row = toLineRow(saved[0], t, 0, DEFAULT_LABOR_RULE);
    expect(fromLineRow(row)).toMatchObject({ affiliation: 'partner', supplierId: S, laborContract: 'ukeoi' });
    // その後マスターで自社に変えた。保存済みの値（prev）を渡して保存し直す。
    const changed = { ...m, workers: [own, { ...partner, affiliation: 'own' as const, supplierId: null }] };
    const prev = new Map([[P, { affiliation: 'partner' as const, supplierId: S, laborContract: 'ukeoi' as const }]]);
    expect(applyMasterSnapshots([fromLineRow(row)!], '2026-11-01', changed, prev)[0]).toMatchObject({
      affiliation: 'partner', supplierId: S, laborContract: 'ukeoi', dailyRate: 20000,
    });
  });
  it('保存し直し：常用・請負が未指定（古い画面）なら保存済みの請負のまま。画面で選び直せばその値', () => {
    const prev = new Map([[P, { affiliation: 'partner' as const, supplierId: S, laborContract: 'ukeoi' as const }]]);
    expect(applyMasterSnapshots([labor(P)], '2026-11-01', m, prev)[0]).toMatchObject({ laborContract: 'ukeoi' });
    expect(applyMasterSnapshots([labor(P, { laborContract: 'jouyou' })], '2026-11-01', m, prev)[0]).toMatchObject({ laborContract: 'jouyou' });
  });
  it('保存し直し：常用・請負が null（常用を選んだ・選び直した）なら保存済みが請負でも常用', () => {
    const prev = new Map([[P, { affiliation: 'partner' as const, supplierId: S, laborContract: 'ukeoi' as const }]]);
    expect(applyMasterSnapshots([labor(P, { laborContract: null })], '2026-11-01', m, prev)[0]).toMatchObject({ laborContract: 'jouyou' });
    expect(applyMasterSnapshots([labor(P, { laborContract: undefined })], '2026-11-01', m, prev)[0]).toMatchObject({ laborContract: 'ukeoi' });
  });
  it('保存し直し：古い日報に新しく加えた作業員はいまのマスターを写す', () => {
    const prev = new Map([[W1, { affiliation: 'own' as const, supplierId: null, laborContract: null }]]);
    const out = applyMasterSnapshots([labor(W1), labor(P)], '2026-11-01', m, prev);
    expect(out[0]).toMatchObject({ affiliation: 'own', supplierId: null, laborContract: null });
    expect(out[1]).toMatchObject({ affiliation: 'partner', supplierId: S, laborContract: 'jouyou' });
  });
  it('うち常用の時間（2026-11-17）は区分が請負の協力会社の行だけ残し、それ以外は null', () => {
    const out = applyMasterSnapshots(
      [
        labor(P, { laborContract: 'ukeoi', jouyouHours: 4 }),
        labor(P, { laborContract: 'jouyou', jouyouHours: 4 }),
        labor(W1, { jouyouHours: 4 }),
        labor(null, { jouyouHours: 4 }),
      ],
      '2026-11-01',
      m,
    );
    expect(out[0]).toMatchObject({ laborContract: 'ukeoi', jouyouHours: 4 });
    expect(out[1]).toMatchObject({ laborContract: 'jouyou', jouyouHours: null });
    expect(out[2]).toMatchObject({ affiliation: 'own', jouyouHours: null });
    expect(out[3]).toMatchObject({ affiliation: null, jouyouHours: null });
  });
});
