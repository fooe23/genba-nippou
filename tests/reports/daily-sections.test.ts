import { describe, it, expect } from 'vitest';
import { formatCell, type SectionTable } from '@/lib/reports/cost-sections';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { commonTimeText, dailyDateLabel, dailyHeaderRows, dailyTables, visitText } from '@/lib/reports/daily-sections';
import { report, sampleDaily, site } from './daily-fixture';

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

  it('本日原価集計：5 費目は明細の保存値、合計は見出しの cost_total（保存値）', () => {
    const t = dailyTables(sampleDaily({ report: report('2026-11-02', { costTotal: 99_999 }) })).costs;
    expect(text(t)).toEqual([
      ['労務費', '35,345'],
      ['車両費（燃料）', '714'],
      ['リース費', '8,000'],
      ['現金購入費', '1,200'],
      ['買掛費', '15,800'],
    ]);
    expect(t.total?.map(formatCell)).toEqual(['合計', '99,999']);
  });

  it('本日出来高：本日・累計・請負金額・進捗率', () => {
    expect(text(dailyTables(sampleDaily()).output)).toEqual([
      ['本日出来高(円)', '100,000'],
      ['累計出来高(円)', '250,000'],
      ['請負金額(円)', '1,000,000'],
      ['進捗率(%)', '25.0'],
    ]);
  });

  it('作業内容：工種・施工内容・数量・単位・投入人工・歩掛・単価・金額', () => {
    const t = dailyTables(sampleDaily()).work;
    expect(text(t)).toEqual([
      ['大工', '床下地, "1 階"', '20', 'm2', '2', '10', '5,000', '100,000'],
      ['', '片付け', '—', '', '0.5', '—', '—', '0'],
    ]);
    expect(t.total?.map(formatCell)).toEqual(['合計', '', '', '', '2.5', '', '', '100,000']);
  });

  it('重要事項の件：本文と状態（対応中／完了）', () => {
    expect(text(dailyTables(sampleDaily()).issues)).toEqual([
      ['棚の追加', '対応中'],
      ['窓の変更', '完了'],
    ]);
  });
});
