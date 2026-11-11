import { describe, it, expect } from 'vitest';
import {
  changeReportFileName,
  costReportFileName,
  dailyReportFileName,
  ledgerFileName,
  parseChangesQuery,
  parseLedgerQuery,
  parseCostQuery,
  parseDailyQuery,
} from '@/lib/reports/query';

const SITE = '0b6c2f9e-1a2b-4c3d-8e9f-0123456789ab';
const url = (q: string) => `http://localhost/api/reports/cost?${q}`;

describe('parseCostQuery', () => {
  it('現場・期間（all か YYYY-MM）・形式を返す', () => {
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf`))).toEqual({
      siteId: SITE,
      period: { kind: 'all' },
      format: 'pdf',
      disposition: 'attachment',
    });
    expect(parseCostQuery(new URL(url(`site=${SITE}&period=2026-11&format=xlsx`)))).toEqual({
      siteId: SITE,
      period: { kind: 'month', month: '2026-11' },
      format: 'xlsx',
      disposition: 'attachment',
    });
    expect(parseCostQuery(url(`format=csv&period=2026-01&site=${SITE}`))).toMatchObject({ format: 'csv' });
  });

  it('現場が無い・uuid でなければエラー', () => {
    expect(parseCostQuery(url('period=all&format=pdf'))).toEqual({ error: '現場の指定が正しくありません' });
    expect(parseCostQuery(url('site=abc&period=all&format=pdf'))).toEqual({ error: '現場の指定が正しくありません' });
  });

  it('期間が無い・形式が違えばエラー', () => {
    for (const p of ['', 'ALL', '2026-13', '2026-1', '2026-11-01']) {
      expect(parseCostQuery(url(`site=${SITE}&period=${p}&format=pdf`))).toEqual({ error: '集計期間の指定が正しくありません' });
    }
    expect(parseCostQuery(url(`site=${SITE}&format=pdf`))).toEqual({ error: '集計期間の指定が正しくありません' });
  });

  it('形式が pdf・xlsx・csv 以外ならエラー', () => {
    for (const f of ['', 'xlsm', 'PDF']) {
      expect(parseCostQuery(url(`site=${SITE}&period=all&format=${f}`))).toEqual({ error: '出力形式の指定が正しくありません' });
    }
  });

  it('disposition=inline は PDF のときだけ inline、それ以外は attachment（エラーにしない）', () => {
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf&disposition=inline`))).toMatchObject({ format: 'pdf', disposition: 'inline' });
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf`))).toMatchObject({ disposition: 'attachment' });
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf&disposition=attachment`))).toMatchObject({ disposition: 'attachment' });
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf&disposition=INLINE`))).toMatchObject({ disposition: 'attachment' });
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=xlsx&disposition=inline`))).toMatchObject({ format: 'xlsx', disposition: 'attachment' });
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=csv&disposition=inline`))).toMatchObject({ format: 'csv', disposition: 'attachment' });
  });
});

describe('costReportFileName', () => {
  it('工期全体は出力日（YYYYMMDD）、月は YYYY年MM月', () => {
    expect(costReportFileName('〇〇邸新築工事', { kind: 'all' }, '2026-11-03', 'pdf')).toBe('〇〇邸新築工事_工事原価集計表_20261103.pdf');
    expect(costReportFileName('〇〇邸', { kind: 'month', month: '2026-01' }, '2026-11-03', 'xlsx')).toBe('〇〇邸_工事原価集計表_2026年01月.xlsx');
  });

  it('禁止文字は _、空なら「現場」（原本 Excel と同じ規則）', () => {
    expect(costReportFileName(' A/B:C*? ', { kind: 'all' }, '2026-11-03', 'csv')).toBe('A_B_C___工事原価集計表_20261103.csv');
    expect(costReportFileName('  ', { kind: 'all' }, '2026-11-03', 'csv')).toBe('現場_工事原価集計表_20261103.csv');
  });
});

const dailyUrl = (q: string) => `http://localhost/api/reports/daily?${q}`;

describe('parseDailyQuery', () => {
  it('日付（YYYY-MM-DD）か年月（YYYY-MM）のどちらか一方と、形式（pdf・csv）を返す', () => {
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=pdf`))).toEqual({
      siteId: SITE,
      target: { kind: 'date', date: '2026-11-02' },
      format: 'pdf',
      disposition: 'attachment',
      audience: 'internal',
    });
    expect(parseDailyQuery(new URL(dailyUrl(`format=csv&month=2026-11&site=${SITE}`)))).toEqual({
      siteId: SITE,
      target: { kind: 'month', month: '2026-11' },
      format: 'csv',
      disposition: 'attachment',
      audience: 'internal',
    });
  });

  it('現場が無い・uuid でなければエラー', () => {
    expect(parseDailyQuery(dailyUrl('date=2026-11-02&format=pdf'))).toEqual({ error: '現場の指定が正しくありません' });
    expect(parseDailyQuery(dailyUrl('site=abc&date=2026-11-02&format=pdf'))).toEqual({ error: '現場の指定が正しくありません' });
  });

  it('日付と年月の両方・どちらも無いときはエラー', () => {
    const both = { error: '日付か年月のどちらか一方を指定してください' };
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&month=2026-11&format=pdf`))).toEqual(both);
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&format=pdf`))).toEqual(both);
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=&month=&format=pdf`))).toEqual(both);
  });

  it('日付・年月の形式が違えばエラー（存在しない日も）', () => {
    for (const d of ['2026-11', '2026/11/02', '2026-11-2', '2026-02-30', '2026-13-01', 'today']) {
      expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=${d}&format=pdf`))).toEqual({ error: '日付の指定が正しくありません' });
    }
    for (const m of ['2026-13', '2026-1', '2026-11-01', 'all']) {
      expect(parseDailyQuery(dailyUrl(`site=${SITE}&month=${m}&format=pdf`))).toEqual({ error: '年月の指定が正しくありません' });
    }
  });

  it('形式が pdf・csv 以外ならエラー（日報に Excel は無い）', () => {
    for (const f of ['', 'xlsx', 'PDF']) {
      expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=${f}`))).toEqual({ error: '出力形式の指定が正しくありません' });
    }
  });

  it('disposition=inline は PDF のときだけ inline、CSV は attachment（エラーにしない）', () => {
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=pdf&disposition=inline`))).toMatchObject({ disposition: 'inline' });
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&month=2026-11&format=pdf&disposition=inline`))).toMatchObject({ disposition: 'inline' });
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=pdf`))).toMatchObject({ disposition: 'attachment' });
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=csv&disposition=inline`))).toMatchObject({
      format: 'csv',
      disposition: 'attachment',
    });
  });

  it('audience=client（お客様用）は 1 日分の PDF だけ。月まとめ・CSV と組み合わせるとエラー', () => {
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=pdf&audience=client&disposition=inline`))).toEqual({
      siteId: SITE,
      target: { kind: 'date', date: '2026-11-02' },
      format: 'pdf',
      disposition: 'inline',
      audience: 'client',
    });
    const only = { error: 'お客様用は 1 日分の PDF だけです' };
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&month=2026-11&format=pdf&audience=client`))).toEqual(only);
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&date=2026-11-02&format=csv&audience=client`))).toEqual(only);
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&month=2026-11&format=csv&audience=client`))).toEqual(only);
    // 別の値・指定なしは社内用（エラーにしない）
    expect(parseDailyQuery(dailyUrl(`site=${SITE}&month=2026-11&format=csv&audience=other`))).toMatchObject({ audience: 'internal' });
  });
});

describe('dailyReportFileName', () => {
  it('お客様用は 現場名_日報（お客様用）_YYYY-MM-DD.pdf', () => {
    expect(dailyReportFileName('〇〇邸新築工事', { kind: 'date', date: '2026-11-02' }, 'pdf', 'client')).toBe(
      '〇〇邸新築工事_日報（お客様用）_2026-11-02.pdf',
    );
    expect(dailyReportFileName('〇〇邸新築工事', { kind: 'date', date: '2026-11-02' }, 'pdf', 'internal')).toBe('〇〇邸新築工事_日報_2026-11-02.pdf');
  });

  it('1 日分は 現場名_日報_YYYY-MM-DD、月まとめは 現場名_日報_YYYY年MM月', () => {
    expect(dailyReportFileName('〇〇邸新築工事', { kind: 'date', date: '2026-11-02' }, 'pdf')).toBe('〇〇邸新築工事_日報_2026-11-02.pdf');
    expect(dailyReportFileName('〇〇邸', { kind: 'month', month: '2026-01' }, 'csv')).toBe('〇〇邸_日報_2026年01月.csv');
  });

  it('禁止文字は _、空なら「現場」（原本 Excel と同じ規則）', () => {
    expect(dailyReportFileName(' A/B:C*? ', { kind: 'date', date: '2026-11-02' }, 'pdf')).toBe('A_B_C___日報_2026-11-02.pdf');
    expect(dailyReportFileName('  ', { kind: 'month', month: '2026-11' }, 'csv')).toBe('現場_日報_2026年11月.csv');
  });
});

const changesUrl = (q: string) => `http://localhost/api/reports/changes?${q}`;

describe('parseChangesQuery', () => {
  it('現場・期間（all か YYYY-MM）・形式（pdf・xlsx）を返す', () => {
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=pdf`))).toEqual({
      siteId: SITE,
      period: { kind: 'all' },
      format: 'pdf',
      disposition: 'attachment',
      audience: 'internal',
    });
    expect(parseChangesQuery(new URL(changesUrl(`format=xlsx&period=2026-11&site=${SITE}`)))).toEqual({
      siteId: SITE,
      period: { kind: 'month', month: '2026-11' },
      format: 'xlsx',
      disposition: 'attachment',
      audience: 'internal',
    });
  });

  it('現場・期間・形式（csv は無い）が違えばエラー', () => {
    expect(parseChangesQuery(changesUrl('site=abc&period=all&format=pdf'))).toEqual({ error: '現場の指定が正しくありません' });
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=2026-13&format=pdf`))).toEqual({ error: '集計期間の指定が正しくありません' });
    for (const f of ['', 'csv', 'xlsm', 'PDF']) {
      expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=${f}`))).toEqual({ error: '出力形式の指定が正しくありません' });
    }
  });

  it('disposition=inline は PDF のときだけ inline、xlsx は attachment（エラーにしない）', () => {
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=pdf&disposition=inline`))).toMatchObject({ disposition: 'inline' });
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=2026-11&format=pdf`))).toMatchObject({ disposition: 'attachment' });
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=xlsx&disposition=inline`))).toMatchObject({
      format: 'xlsx',
      disposition: 'attachment',
    });
  });

  it('audience=client は客先用、指定なし・別の値は社内確認用', () => {
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=pdf&audience=client`))).toMatchObject({ audience: 'client' });
    expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=xlsx&audience=client`))).toMatchObject({ audience: 'client' });
    for (const a of ['internal', 'CLIENT', 'x', '']) {
      expect(parseChangesQuery(changesUrl(`site=${SITE}&period=all&format=pdf&audience=${a}`))).toMatchObject({ audience: 'internal' });
    }
  });
});

describe('changeReportFileName', () => {
  it('社内確認用：工期全体は出力日（YYYYMMDD）、月は YYYY年MM月', () => {
    expect(changeReportFileName('〇〇邸新築工事', { kind: 'all' }, '2026-11-03', 'pdf', 'internal')).toBe('〇〇邸新築工事_変更増減_社内確認用_20261103.pdf');
    expect(changeReportFileName('〇〇邸', { kind: 'month', month: '2026-01' }, '2026-11-03', 'xlsx', 'internal')).toBe('〇〇邸_変更増減_社内確認用_2026年01月.xlsx');
  });

  it('客先用：現場名_精算のご提案_YYYYMMDD、月は YYYY年MM月', () => {
    expect(changeReportFileName('〇〇邸新築工事', { kind: 'all' }, '2026-11-03', 'pdf', 'client')).toBe('〇〇邸新築工事_精算のご提案_20261103.pdf');
    expect(changeReportFileName('〇〇邸', { kind: 'month', month: '2026-01' }, '2026-11-03', 'xlsx', 'client')).toBe('〇〇邸_精算のご提案_2026年01月.xlsx');
  });

  it('禁止文字は _、空なら「現場」', () => {
    expect(changeReportFileName(' A/B:C*? ', { kind: 'all' }, '2026-11-03', 'pdf', 'client')).toBe('A_B_C___精算のご提案_20261103.pdf');
    expect(changeReportFileName('  ', { kind: 'all' }, '2026-11-03', 'xlsx', 'internal')).toBe('現場_変更増減_社内確認用_20261103.xlsx');
  });
});

describe('parseLedgerQuery（現場管理台帳 /api/export）', () => {
  const u = (q: string) => `http://localhost/api/export?${q}`;
  it('現場・期間（all か YYYY-MM）を返す。format は要らない', () => {
    expect(parseLedgerQuery(u(`site=${SITE}&period=all`))).toEqual({ siteId: SITE, period: { kind: 'all' } });
    expect(parseLedgerQuery(new URL(u(`period=2026-11&site=${SITE}&format=pdf`)))).toEqual({ siteId: SITE, period: { kind: 'month', month: '2026-11' } });
  });
  it('現場・期間が違えばエラー（以前の ?month= だけでもエラー）', () => {
    expect(parseLedgerQuery(u('period=all'))).toEqual({ error: '現場の指定が正しくありません' });
    expect(parseLedgerQuery(u(`site=${SITE}&month=2026-11`))).toEqual({ error: '集計期間の指定が正しくありません' });
    expect(parseLedgerQuery(u(`site=${SITE}&period=2026-13`))).toEqual({ error: '集計期間の指定が正しくありません' });
  });
  it('ファイル名', () => {
    expect(ledgerFileName('A/B邸', { kind: 'all' }, '2026-11-12')).toMatch(/_現場管理台帳_20261112\.xlsx$/);
  });
});
