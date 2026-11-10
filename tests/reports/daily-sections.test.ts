import { describe, it, expect } from 'vitest';
import { formatCell, type SectionTable } from '@/lib/reports/cost-sections';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import {
  changeTotalsText,
  clientConfirmationBoxes,
  commonTimeText,
  dailyDateLabel,
  dailyHeaderRows,
  dailyTables,
  visitText,
  workDescription,
} from '@/lib/reports/daily-sections';
import { report, sampleDaily, site, withChanges } from './daily-fixture';

const text = (t: SectionTable) => t.rows.map((r) => r.map(formatCell));

describe('日報の見出し', () => {
  it('日付は YYYY/MM/DD（曜）、年月（日報の無い月）は YYYY年MM月', () => {
    expect(dailyDateLabel('2026-11-02')).toBe('2026/11/02（月）');
    expect(dailyDateLabel('2026-11-05')).toBe('2026/11/05（木）');
    expect(dailyDateLabel('2026-11')).toBe('2026年11月');
  });

  it('当月 N 回目／通算 M 回目（日報の無い日は null）', () => {
    expect(visitText(sampleDaily().header)).toBe('当月 2 回目／通算 4 回目');
    expect(visitText(buildEmptyDailyReport(site, '2026-11-04').header)).toBeNull();
  });

  it('共通時間：開始〜終了 休憩 中抜。空の休憩・中抜は出さない。全部空なら null', () => {
    expect(commonTimeText({ start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 })).toBe('08:00〜17:30　休憩 90分　中抜 0分');
    expect(commonTimeText({ start: '08:00', end: '17:00', breakMin: null, gapMin: null })).toBe('08:00〜17:00');
    expect(commonTimeText({ start: null, end: null, breakMin: null, gapMin: null })).toBeNull();
  });

  it('工事番号・天候・作業責任者・共通時間', () => {
    expect(dailyHeaderRows(sampleDaily())).toEqual([
      ['工事番号', 'K-001'],
      ['天候', '晴れ'],
      ['作業責任者', '大江'],
      ['共通時間', '08:00〜17:30　休憩 90分　中抜 0分'],
    ]);
  });
});

describe('dailyTables', () => {
  it('作業員：時刻・休憩・中抜・実働・人工・残業・日当・労務費（保存値）・備考。手入力は「（手入力）」', () => {
    const t = dailyTables(sampleDaily()).workers;
    expect(t.columns.map((c) => c.label)).toEqual([
      '名前', '開始', '終了', '休憩(分)', '中抜(分)', '実働H', '人工', '残業H', '日当(円)', '労務費(円)', '備考',
    ]);
    expect(text(t)).toEqual([
      ['田中', '08:00', '17:30', '90', '0', '8', '1', '0', '18,000', '18,001', ''],
      ['飛び込み 鈴木（手入力）', '07:00', '19:00', '90', '30', '9', '1', '1.5', '15,000', '17,344', '残業あり'],
      ['佐藤', '08:00', '17:30', '90', '0', '—', '0', '0', '—', '0', ''],
    ]);
    expect(t.total?.map(formatCell)).toEqual(['合計', '', '', '', '', '17', '2', '1.5', '', '35,345', '']);
  });

  it('作業員：空の休憩・中抜は空欄（「—」にしない）', () => {
    const m = sampleDaily({ report: report('2026-11-02', { common: { start: '08:00', end: '17:00', breakMin: null, gapMin: null } }) });
    const rows = text(dailyTables(m).workers);
    expect(rows[0].slice(1, 5)).toEqual(['08:00', '17:00', '', '']);
    expect(rows[1].slice(1, 5)).toEqual(['07:00', '19:00', '', '30']);
  });

  it('車両・リース・現金購入・買掛', () => {
    const t = dailyTables(sampleDaily());
    expect(text(t.vehicles)).toEqual([
      ['2t ダンプ', '10', '42', '170', '714', '残土運搬'],
      ['借用車（手入力）', '—', '10', '—', '0', ''],
    ]);
    expect(t.vehicles.total?.map(formatCell)).toEqual(['合計', '', '52', '', '714', '']);
    expect(text(t.leases)).toEqual([
      ['足場', '枠組', '3', '日', '1,000', '3,000', ''],
      ['発電機（手入力）', '', '1', '台', '5,000', '5,000', '持込'],
    ]);
    expect(text(t.cash)).toEqual([['釘', 'N65', '1', '箱', '1,200', '1,200', '=ホームセンター']]);
    expect(text(t.credit)).toEqual([
      ['合板', '12mm', '10', '枚', '1,500', '15,000', '山田商店'],
      ['金物', '', '1', '式', '800', '800', '川村金物（手入力）'],
    ]);
    expect(t.credit.total?.map(formatCell)).toEqual(['合計', '', '', '', '', '15,800', '']);
  });

  it('本日原価集計：5 費目と合計は明細の保存値（見出しの cost_total は使わない。外注の買掛を含まないため）', () => {
    const t = dailyTables(sampleDaily({ report: report('2026-11-02', { costTotal: 99_999 }) })).costs;
    expect(text(t)).toEqual([
      ['労務費', '35,345'],
      ['車両費（燃料）', '714'],
      ['リース費', '8,000'],
      ['現金購入費', '1,200'],
      ['買掛費', '15,800'],
    ]);
    expect(t.total?.map(formatCell)).toEqual(['合計', '61,059']);
  });

  it('本日出来高：本日・累計・請負金額・進捗率', () => {
    expect(text(dailyTables(sampleDaily()).output)).toEqual([
      ['本日出来高(円)', '100,000'],
      ['累計出来高(円)', '250,000'],
      ['請負金額(円)', '1,000,000'],
      ['進捗率(%)', '25.0'],
    ]);
  });

  it('契約が未確定の現場：「請負金額（未確定）」と「概算金額」の行を出す（未入力は —。進捗率は請負金額が無ければ —）', () => {
    const tentative = (estimatedAmount: number | null) =>
      text(dailyTables(sampleDaily({ site: { ...site, contractStatus: 'tentative', contractAmount: null, estimatedAmount } })).output);
    expect(tentative(800_000)).toEqual([
      ['本日出来高(円)', '100,000'],
      ['累計出来高(円)', '250,000'],
      ['請負金額（未確定）(円)', '—'],
      ['概算金額(円)', '800,000'],
      ['進捗率(%)', '—'],
    ]);
    expect(tentative(null)[3]).toEqual(['概算金額(円)', '—']);
  });

  it('作業内容：工種・施工内容・数量・単位・投入人工・歩掛・単価・金額', () => {
    const t = dailyTables(sampleDaily()).work;
    expect(text(t)).toEqual([
      ['大工', '床下地, "1 階"', '20', 'm2', '2', '10', '5,000', '100,000'],
      ['', '片付け', '—', '', '0.5', '—', '—', '0'],
    ]);
    expect(t.total?.map(formatCell)).toEqual(['合計', '', '', '', '2.5', '', '', '100,000']);
  });

  it('作業内容：追加・増・変更・減の行は施工内容の頭に【区分】を付けて太字。契約内はそのまま', () => {
    const t = dailyTables(withChanges()).work;
    expect(text(t).map((r) => [r[1], r[7]])).toEqual([
      ['床下地, "1 階"', '100,000'],
      ['片付け', '0'],
      ['【追加】棚の追加', '60,001'],
      ['【増】棚板の増', '4,004'],
      ['【変更】窓の変更', '20,002'],
      ['【減】照明の減', '-15,003'],
    ]);
    expect(t.boldRows).toEqual([2, 3, 4, 5]);
    expect(dailyTables(sampleDaily()).work.boldRows).toEqual([]);
  });

  it('施工内容の【区分】は PDF・CSV 共通の 1 つの関数', () => {
    expect(workDescription({ changeKind: 'extra', description: '棚' })).toBe('【追加】棚');
    expect(workDescription({ changeKind: 'increase', description: '棚板' })).toBe('【増】棚板');
    expect(workDescription({ changeKind: 'minus', description: '' })).toBe('【減】');
    expect(workDescription({ changeKind: 'contract', description: '床' })).toBe('床');
  });

  it('本日の追加・増・変更・減：保存値の合計（追加 +／増 +／変更 +／減 −）', () => {
    expect(changeTotalsText({ extra: 60001, increase: 4004, change: 20002, minus: -15003, net: 69004 })).toBe(
      '追加 +60,001／増 +4,004／変更 +20,002／減 −15,003',
    );
    expect(changeTotalsText({ extra: 0, increase: 0, change: -2000, minus: 0, net: -2000 })).toBe('追加 0／増 0／変更 −2,000／減 0');
  });

  it('客先確認の枠：記録が無ければ 確認者名／日付／サイン の空欄、あれば確認者名と確認日時（日本時間）', () => {
    expect(clientConfirmationBoxes(null)).toEqual([['確認者名', ''], ['日付', ''], ['サイン', '']]);
    expect(clientConfirmationBoxes({ by: '施主 〇〇様', at: '2026-11-02T08:15:00+00:00', note: '現地で確認' })).toEqual([
      ['確認者名', '施主 〇〇様'],
      ['確認日時', '2026/11/02 17:15'],
      ['サイン', ''],
    ]);
  });

  it('重要事項の件：本文と状態（対応中／完了）', () => {
    expect(text(dailyTables(sampleDaily()).issues)).toEqual([
      ['棚の追加', '対応中'],
      ['窓の変更', '完了'],
    ]);
  });
});

describe('買掛の列名と外注の行（2026-11-17）', () => {
  it('買掛の列は「支払先」「支払金額(円)」。現金は「購入先」「金額(円)」のまま', () => {
    const t = dailyTables(sampleDaily());
    expect(t.credit.columns.map((c) => c.label)).toEqual(['品名', '規格', '数量', '単位', '単価(円)', '支払金額(円)', '支払先']);
    expect(t.cash.columns.map((c) => c.label)).toEqual(['品名', '規格', '数量', '単位', '単価(円)', '金額(円)', '購入先']);
  });
  it('外注の行は品名の頭に【外注・工種名】', () => {
    const base = report();
    const sub = {
      kind: 'credit' as const, itemName: 'タイル工事', spec: '', unit: '式', qty: 1, unitPrice: 100000, supplierId: 'sp9', vendor: '東北建興',
      purchaseKind: 'subcontract' as const, siteTradeId: 't1', issueId: null,
      stored: { amount: 100000, manDays: 0, overtimeHours: 0, hours: 0 },
    };
    const m = sampleDaily({ report: { ...base, lines: [...base.lines, sub] }, tradeNames: { t1: 'タイル' } });
    expect(m.credit.rows.at(-1)).toMatchObject({ name: '【外注・タイル】タイル工事', vendor: '東北建興', amount: 100000 });
  });
});

describe('本日原価集計の外注（2026-11-17）', () => {
  it('外注の買掛は買掛費に 1 回だけ入り、「うち外注」の行が出る。合計は明細の和', () => {
    const base = report();
    const sub = {
      kind: 'credit' as const, itemName: 'タイル工事', spec: '', unit: '式', qty: 1, unitPrice: 100000, supplierId: 'sp9', vendor: '東北建興',
      purchaseKind: 'subcontract' as const, siteTradeId: null, issueId: null,
      stored: { amount: 100000, manDays: 0, overtimeHours: 0, hours: 0 },
    };
    const m = sampleDaily({ report: { ...base, lines: [...base.lines, sub] } });
    expect(m.costs).toMatchObject({ credit: 115800, subcontract: 100000, total: 161059 });
    const t = dailyTables(m).costs;
    expect(text(t)).toContainEqual(['買掛費', '115,800']);
    expect(text(t)).toContainEqual(['　うち外注', '100,000']);
    expect(t.total?.map(formatCell)).toEqual(['合計', '161,059']);
  });
});
