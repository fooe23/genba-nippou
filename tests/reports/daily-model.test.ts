import { describe, it, expect } from 'vitest';
import { buildDailyReport, buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { COST_TOTAL, dailyInput, issues, report, sampleDaily, site, withChanges } from './daily-fixture';
import { EMPTY_LABOR_COST_CONTEXT } from '@/lib/calc/labor-cost';
import { buildDailyCsv } from '@/lib/reports/daily-csv';
import { dailyTables } from '@/lib/reports/daily-sections';
import type { SavedReportLine } from '@/lib/reports/types';

describe('buildDailyReport', () => {
  it('見出し：現場名・工事番号・日付・当月 N 回目／通算 M 回目・天候・作業責任者・共通時間', () => {
    const m = sampleDaily();
    expect(m.isEmpty).toBe(false);
    expect(m.header).toEqual({
      siteName: '〇〇邸新築工事',
      projectNo: 'K-001',
      date: '2026-11-02',
      monthIndex: 2,
      totalIndex: 4,
      weather: '晴れ',
      supervisor: '大江',
      common: { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 },
    });
  });

  it('回目は reportDates に自分が無くても自分を含めて数える', () => {
    const m = sampleDaily({ reportDates: ['2026-10-20'] });
    expect([m.header.monthIndex, m.header.totalIndex]).toEqual([1, 2]);
  });

  it('作業員：時刻は行の値（無ければアプリと同じく共通時間）、実働・人工・残業・労務費は保存値', () => {
    const m = sampleDaily();
    expect(m.workers.rows).toEqual([
      {
        workerId: 'w1', name: '田中', manual: false, headcount: 1, start: '08:00', end: '17:30', breakMin: 90, gapMin: 0,
        hours: 8, manDays: 1, overtimeHours: 0, dailyRate: 18000, cost: 18001, contract: 'own', jouyouHours: null, ukeoiManDays: 0, note: '',
      },
      {
        workerId: null, name: '飛び込み 鈴木', manual: true, headcount: 1, start: '07:00', end: '19:00', breakMin: 90, gapMin: 30,
        hours: 9, manDays: 1, overtimeHours: 1.5, dailyRate: 15000, cost: 17344, contract: 'own', jouyouHours: null, ukeoiManDays: 0, note: '残業あり',
      },
      {
        // 終了が空 → 実働は共通時間で計算されるので、時刻も共通時間を出す。saved が無いので実働は null。
        workerId: 'w2', name: '佐藤', manual: false, headcount: 1, start: '08:00', end: '17:30', breakMin: 90, gapMin: 0,
        hours: null, manDays: 0, overtimeHours: 0, dailyRate: null, cost: 0, contract: 'own', jouyouHours: null, ukeoiManDays: 0, note: '',
      },
    ]);
    expect(m.workers.total).toEqual({ hours: 17, manDays: 2, ukeoiManDays: 0, overtimeHours: 1.5, cost: 35345 });
  });

  it('車両・リース・現金購入・買掛：金額は保存値、参照の無い行は手入力', () => {
    const m = sampleDaily();
    expect(m.vehicles.rows).toEqual([
      { vehicleId: 'v1', name: '2t ダンプ', manual: false, kmPerL: 10, distanceKm: 42, pricePerL: 170, cost: 714, note: '残土運搬' },
      { vehicleId: null, name: '借用車', manual: true, kmPerL: null, distanceKm: 10, pricePerL: null, cost: 0, note: '' },
    ]);
    expect(m.vehicles.total).toEqual({ distanceKm: 52, cost: 714 });
    expect(m.leases.rows.map((r) => [r.name, r.manual, r.spec, r.unit, r.qty, r.unitPrice, r.amount, r.note])).toEqual([
      ['足場', false, '枠組', '日', 3, 1000, 3000, ''],
      ['発電機', true, '', '台', 1, 5000, 5000, '持込'],
    ]);
    expect(m.leases.total).toEqual({ amount: 8000 });
    expect(m.cash.rows).toEqual([{ name: '釘', spec: 'N65', unit: '箱', qty: 1, unitPrice: 1200, amount: 1200, vendor: '=ホームセンター', vendorManual: false }]);
    expect(m.credit.rows.map((r) => [r.name, r.vendor, r.vendorManual, r.amount])).toEqual([
      ['合板', '山田商店', false, 15000],
      ['金物', '川村金物', true, 800],
    ]);
    expect(m.credit.total).toEqual({ amount: 15800 });
  });

  it('本日原価集計：明細の保存値を費目ごとに足す（合計も明細の和）', () => {
    const m = sampleDaily();
    expect(m.costs).toEqual({ labor: 35345, fuel: 714, lease: 8000, cash: 1200, credit: 15800, subcontract: 0, total: COST_TOTAL });
  });

  it('本日出来高と進捗率 = (前日までの出来高 + 本日) ÷ 請負金額', () => {
    const m = sampleDaily();
    expect(m.output).toEqual({
      today: 100000, cumulative: 250000, contractAmount: 1_000_000, progress: 0.25, tentative: false, estimatedAmount: null,
    });
  });

  it('契約が未確定の現場：tentative と概算金額を持つ。進捗率の基準は請負金額のまま（無ければ null）', () => {
    const tentative = sampleDaily({ site: { ...site, contractStatus: 'tentative', contractAmount: null, estimatedAmount: 800_000 } });
    expect(tentative.output).toEqual({
      today: 100000, cumulative: 250000, contractAmount: null, progress: null, tentative: true, estimatedAmount: 800_000,
    });
    // 確定の現場では概算金額を持たない（入力が残っていても使わない）
    expect(sampleDaily({ site: { ...site, estimatedAmount: 800_000 } }).output.estimatedAmount).toBeNull();
    expect(buildEmptyDailyReport({ ...site, contractStatus: 'tentative', estimatedAmount: null }, '2026-11-04').output).toMatchObject({
      tentative: true, estimatedAmount: null, progress: null,
    });
  });

  it('請負金額が無い（null・0）なら進捗率は null', () => {
    expect(sampleDaily({ site: { ...site, contractAmount: null } }).output.progress).toBeNull();
    expect(sampleDaily({ site: { ...site, contractAmount: 0 } }).output.progress).toBeNull();
  });

  it('作業内容：投入人工は保存値、歩掛 = 数量 ÷ 投入人工（決められなければ null）', () => {
    const m = sampleDaily();
    expect(m.work.rows).toEqual([
      { trade: '大工', description: '床下地, "1 階"', qty: 20, unit: 'm2', manDays: 2, productivity: 10, unitPrice: 5000, amount: 100000, changeKind: 'contract' },
      { trade: '', description: '片付け', qty: null, unit: '', manDays: 0.5, productivity: null, unitPrice: null, amount: 0, changeKind: 'contract' },
    ]);
    expect(m.work.total).toEqual({ manDays: 2.5, amount: 100000 });
    // 追加・増・変更・減の行が無い日は小計なし。
    expect(m.work.changes).toBeNull();
  });

  it('作業内容の区分と「本日の追加・増・変更・減」：区分ごとの保存値（stored.amount）の合計。減は負のまま', () => {
    const m = withChanges();
    expect(m.work.rows.map((r) => [r.description, r.changeKind, r.amount])).toEqual([
      ['床下地, "1 階"', 'contract', 100000],
      ['片付け', 'contract', 0],
      ['棚の追加', 'extra', 60001],
      ['棚板の増', 'increase', 4004],
      ['窓の変更', 'change', 20002],
      ['照明の減', 'minus', -15003],
    ]);
    // 数量 × 単価（60000・4000・20000・−15000）ではなく保存値。
    expect(m.work.changes).toEqual({ extra: 60001, increase: 4004, change: 20002, minus: -15003, net: 69004 });
    expect(m.work.total).toEqual({ manDays: 4.5, amount: 169004 });
  });

  it('客先確認：記録があれば確認者名・日時・メモ、無ければ null。日報の無い日も null', () => {
    expect(sampleDaily().clientConfirmation).toBeNull();
    expect(withChanges().clientConfirmation).toEqual({
      by: '施主 〇〇様',
      at: '2026-11-02T08:15:00+00:00',
      note: '棚の追加と窓の変更を現地で確認。照明は 3 台減で了承。',
    });
    expect(withChanges({ clientConfirmedNote: null }).clientConfirmation?.note).toBe('');
    expect(buildEmptyDailyReport(site, '2026-11-04').clientConfirmation).toBeNull();
    expect(buildEmptyDailyReport(site, '2026-11-04').work.changes).toBeNull();
  });

  it('重要事項（本文＋件）・連絡事項・署名欄', () => {
    const m = sampleDaily();
    expect(m.issues).toEqual({
      text: '施主より追加の依頼あり',
      items: [
        { number: 1, body: '棚の追加', status: 'open', doneAt: null, kind: 'other', instructedBy: null, instructionMethod: null },
        { number: 2, body: '窓の変更', status: 'done', doneAt: '2026-11-04T03:00:00Z', kind: 'other', instructedBy: null, instructionMethod: null },
      ],
    });
    expect(m.notes).toBe('明日は雨天予報');
    expect(m.signature).toEqual({ createdBy: '作成 太郎', reviewedBy: '確認 次郎', approvedBy: '承認 三郎', approvedAt: '2026-11-03T01:00:00Z' });
  });

  it('件の番号（その日報の中での登録順）・種別・指示者・指示の方法', () => {
    const m = sampleDaily({
      issues: [
        { ...issues[0], kind: 'extra', instructedBy: '施主 山田様', instructionMethod: 'oral' },
        { ...issues[1], kind: 'rework' },
      ],
    });
    expect(m.issues.items.map(({ number, kind, instructedBy, instructionMethod }) => ({ number, kind, instructedBy, instructionMethod }))).toEqual([
      { number: 1, kind: 'extra', instructedBy: '施主 山田様', instructionMethod: 'oral' },
      { number: 2, kind: 'rework', instructedBy: null, instructionMethod: null },
    ]);
  });

  it('名前が読めない作成者は作業責任者で代える。確認者・承認者は null', () => {
    const m = sampleDaily({ names: {} });
    expect(m.signature).toEqual({ createdBy: '大江', reviewedBy: null, approvedBy: null, approvedAt: '2026-11-03T01:00:00Z' });
    const none = buildDailyReport(dailyInput({ names: {}, report: report('2026-11-02', { supervisor: null, reviewedBy: null, approvedBy: null, approvedAt: null }) }));
    expect(none.signature).toEqual({ createdBy: null, reviewedBy: null, approvedBy: null, approvedAt: null });
  });

  it('明細が無い日報は空の表（日報としては存在する）', () => {
    const m = buildDailyReport(dailyInput({ report: report('2026-11-02', { lines: [], costTotal: 0, outputTotal: 0 }), issues: [] }));
    expect(m.isEmpty).toBe(false);
    expect(m.workers).toEqual({ rows: [], total: { hours: 0, manDays: 0, ukeoiManDays: 0, overtimeHours: 0, cost: 0 } });
    expect(m.costs.total).toBe(0);
    expect(m.output.progress).toBe(0.15);
  });
});

describe('buildEmptyDailyReport', () => {
  it('日報の無い日は空のモデル（エラーにしない）', () => {
    const m = buildEmptyDailyReport(site, '2026-11-03');
    expect(m.isEmpty).toBe(true);
    expect(m.header).toEqual({
      siteName: '〇〇邸新築工事', projectNo: 'K-001', date: '2026-11-03', monthIndex: null, totalIndex: null,
      weather: null, supervisor: null, common: { start: null, end: null, breakMin: null, gapMin: null },
    });
    expect(m.workers.rows).toEqual([]);
    expect(m.work.rows).toEqual([]);
    expect(m.costs).toEqual({ labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, total: 0 });
    expect(m.output).toEqual({ today: 0, cumulative: null, contractAmount: 1_000_000, progress: null, tentative: false, estimatedAmount: null });
    expect(m.signature).toEqual({ createdBy: null, reviewedBy: null, approvedBy: null, approvedAt: null });
  });
});

describe('労務費の決まり（2026-11-17。村山様邸の 1 日：大江・A・B・C）', () => {
  const noTime = { start: null, end: null, breakMin: null, gapMin: null };
  const st = (amount: number, manDays: number, hours = 8) => ({ amount, manDays, overtimeHours: 0, hours });
  const lab = (name: string, extra: Record<string, unknown>, amount: number): SavedReportLine =>
    ({ kind: 'labor', workerId: name, workerName: name, time: noTime, dailyRate: amount, note: '', overtimeRate: null, stored: st(amount, 1), ...extra }) as SavedReportLine;
  const murayama = [
    lab('大江', { affiliation: 'own' }, 20000),
    lab('A', { affiliation: 'partner', supplierId: 'tohoku', laborContract: 'ukeoi', jouyouHours: 4 }, 22000),
    lab('B', { affiliation: 'partner', supplierId: 'tohoku', laborContract: 'ukeoi', jouyouHours: null }, 22000),
    lab('C', { affiliation: 'partner', supplierId: 'marumaru', laborContract: 'jouyou' }, 22000),
  ];
  const m = buildDailyReport(dailyInput({ report: report('2026-11-10', { lines: murayama }), issues: [] }));

  it('労務費 ¥20,000 ＋ ¥11,000 ＋ ¥0 ＋ ¥22,000 ＝ ¥53,000、出面 4.0 人工（うち請負 1.5）', () => {
    expect(m.workers.rows.map((r) => [r.name, r.manDays, r.cost, r.contract, r.jouyouHours, r.ukeoiManDays])).toEqual([
      ['大江', 1, 20000, 'own', null, 0],
      ['A', 1, 11000, 'ukeoi', 4, 0.5],
      ['B', 1, 0, 'ukeoi', null, 1],
      ['C', 1, 22000, 'jouyou', null, 0],
    ]);
    expect(m.workers.total).toMatchObject({ manDays: 4, ukeoiManDays: 1.5, cost: 53000 });
    expect(m.costs.labor).toBe(53000);
    expect(m.costs.total).toBe(53000);
  });

  it('帳票の作業員の備考に【請負】【請負・うち常用 4H】、本日原価集計に「うち請負の人工（原価に数えない）」', () => {
    const t = dailyTables(m);
    expect(t.workers.rows.map((r) => r[r.length - 1])).toEqual(['', '【請負・うち常用 4H】', '【請負】', '']);
    expect(t.costs.rows).toContainEqual(['　うち請負の人工（原価に数えない）', '1.5人工']);
    const csv = buildDailyCsv([m]);
    expect(csv).toContain('【請負・うち常用 4H】');
  });

  it('実行予算の常用の単価（東北建興 ¥25,000）があれば A さんは ¥12,500', () => {
    const withRate = buildDailyReport(
      dailyInput({ report: report('2026-11-10', { lines: murayama }), issues: [], laborCost: { ...EMPTY_LABOR_COST_CONTEXT, jouyouRates: { tohoku: 25000 } } }),
    );
    expect(withRate.workers.rows[1].cost).toBe(12500);
  });
});

describe('名前なし（会社と人数）の作業員の行（2026-11-19）', () => {
  const unnamed: SavedReportLine = {
    kind: 'labor', workerId: null, workerName: '東北建興（名前なし）', time: { start: null, end: null, breakMin: null, gapMin: null },
    dailyRate: 20000, note: '', overtimeRate: null, affiliation: 'partner', supplierId: 'p9', laborContract: 'jouyou', jouyouHours: null, headcount: 2,
    saved: { hours: 8, manDays: 2, overtimeHours: 0, cost: 40000 },
    stored: { amount: 40000, manDays: 2, overtimeHours: 0, hours: 8 },
  };
  it('出面は「東北建興（名前なし）2名」（手入力の印なし）、人工・労務費は人数分、合計の実働は人数を掛ける', () => {
    const m = sampleDaily({ report: report('2026-11-02', { lines: [unnamed] }) });
    expect(m.workers.rows[0]).toMatchObject({ name: '東北建興（名前なし）2名', manual: false, headcount: 2, hours: 8, manDays: 2, cost: 40000 });
    expect(m.workers.total.hours).toBe(16);
    expect(dailyTables(m).workers.rows[0][0]).toBe('東北建興（名前なし）2名');
  });
  it('お客様用：作業員の人数は人数分', async () => {
    const { clientDailyTables } = await import('@/lib/reports/client-daily-sections');
    const m = sampleDaily({ report: report('2026-11-02', { lines: [unnamed] }) });
    expect(clientDailyTables(m).workersLine).toBe('作業員 2 名・合計 2.0 人工');
  });
});
