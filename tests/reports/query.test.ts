import { describe, it, expect } from 'vitest';
import { costReportFileName, parseCostQuery } from '@/lib/reports/query';

const SITE = '0b6c2f9e-1a2b-4c3d-8e9f-0123456789ab';
const url = (q: string) => `http://localhost/api/reports/cost?${q}`;

describe('parseCostQuery', () => {
  it('現場・期間（all か YYYY-MM）・形式を返す', () => {
    expect(parseCostQuery(url(`site=${SITE}&period=all&format=pdf`))).toEqual({ siteId: SITE, period: { kind: 'all' }, format: 'pdf' });
    expect(parseCostQuery(new URL(url(`site=${SITE}&period=2026-11&format=xlsx`)))).toEqual({
      siteId: SITE,
      period: { kind: 'month', month: '2026-11' },
      format: 'xlsx',
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
