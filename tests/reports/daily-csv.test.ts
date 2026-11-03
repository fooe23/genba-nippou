import { describe, it, expect } from 'vitest';
import { buildDailyCsv } from '@/lib/reports/daily-csv';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { report, sampleDaily, site, withChanges } from './daily-fixture';

const HEADER = '日付,回目(当月),通算,種別,名前,規格,単位,数量,単価,金額,開始,終了,休憩分,中抜分,実働H,人工,残業H,取引先,工種,施工内容,備考';

/** BOM と CRLF を外して行に分ける（最後の空要素は除く）。 */
function lines(csv: string): string[] {
  expect(csv.startsWith('﻿')).toBe(true);
  const body = csv.slice(1);
  expect(body.endsWith('\r\n')).toBe(true);
  expect(body.slice(0, -2).includes('\r\n\r\n')).toBe(false);
  return body.slice(0, -2).split('\r\n');
}

describe('buildDailyCsv', () => {
  it('1 行目は 21 列の見出し（計画どおりの順）', () => {
    const [header] = lines(buildDailyCsv([sampleDaily()]));
    expect(header).toBe(HEADER);
    expect(header.split(',')).toHaveLength(21);
  });

  it('明細 1 行 1 レコード。作業員→車両→リース→現金購入→買掛→作業内容の順', () => {
    const rows = lines(buildDailyCsv([sampleDaily()])).slice(1);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.split(',')[3])).toEqual([
      '作業員', '作業員', '作業員', '車両', '車両', 'リース', 'リース', '現金購入', '買掛', '買掛', '作業内容', '作業内容',
    ]);
    for (const r of rows) expect(r.startsWith('2026-11-02,2,4,')).toBe(true);
  });

  it('作業員：時刻は HH:MM、休憩・中抜は分、実働・人工・残業・労務費は保存値。手入力は名前に「（手入力）」', () => {
    const rows = lines(buildDailyCsv([sampleDaily()])).slice(1);
    expect(rows[0]).toBe('2026-11-02,2,4,作業員,田中,,,,18000,18001,08:00,17:30,90,0,8,1,0,,,,');
    expect(rows[1]).toBe('2026-11-02,2,4,作業員,飛び込み 鈴木（手入力）,,,,15000,17344,07:00,19:00,90,30,9,1,1.5,,,,残業あり');
    expect(rows[2]).toBe('2026-11-02,2,4,作業員,佐藤,,,,,0,08:00,17:30,90,0,,0,0,,,,');
  });

  it('車両・リース・購入：規格・単位・数量・単価・金額・取引先・備考', () => {
    const rows = lines(buildDailyCsv([sampleDaily()])).slice(1);
    expect(rows[3]).toBe('2026-11-02,2,4,車両,2t ダンプ,10km/L,km,42,170,714,,,,,,,,,,,残土運搬');
    expect(rows[4]).toBe('2026-11-02,2,4,車両,借用車（手入力）,,km,10,,0,,,,,,,,,,,');
    expect(rows[5]).toBe('2026-11-02,2,4,リース,足場,枠組,日,3,1000,3000,,,,,,,,,,,');
    expect(rows[6]).toBe('2026-11-02,2,4,リース,発電機（手入力）,,台,1,5000,5000,,,,,,,,,,,持込');
    // 取引先の先頭の = は toCsv が ' を付けて数式にしない。
    expect(rows[7]).toBe("2026-11-02,2,4,現金購入,釘,N65,箱,1,1200,1200,,,,,,,,'=ホームセンター,,,");
    expect(rows[8]).toBe('2026-11-02,2,4,買掛,合板,12mm,枚,10,1500,15000,,,,,,,,山田商店,,,');
    expect(rows[9]).toBe('2026-11-02,2,4,買掛,金物,,式,1,800,800,,,,,,,,川村金物（手入力）,,,');
  });

  it('作業内容：工種・施工内容・数量・単位・投入人工・単価・金額（" と , を含む値は " で囲む）', () => {
    const rows = lines(buildDailyCsv([sampleDaily()])).slice(1);
    expect(rows[10]).toBe('2026-11-02,2,4,作業内容,,,m2,20,5000,100000,,,,,,2,,,大工,"床下地, ""1 階""",');
    expect(rows[11]).toBe('2026-11-02,2,4,作業内容,,,,,,0,,,,,,0.5,,,,片付け,');
  });

  it('作業内容の追加・増・変更・減：列は 21 のまま、施工内容の頭に【区分】。金額は保存値（減は負）', () => {
    const all = lines(buildDailyCsv([withChanges()]));
    expect(all[0]).toBe(HEADER);
    const rows = all.slice(1);
    expect(rows).toHaveLength(16);
    expect(rows[12]).toBe('2026-11-02,2,4,作業内容,,,台,2,30000,60001,,,,,,1,,,大工,【追加】棚の追加,');
    expect(rows[13]).toBe('2026-11-02,2,4,作業内容,,,枚,1,4000,4004,,,,,,0.5,,,大工,【増】棚板の増,');
    expect(rows[14]).toBe('2026-11-02,2,4,作業内容,,,式,1,20000,20002,,,,,,0.5,,,建具,【変更】窓の変更,');
    expect(rows[15]).toBe('2026-11-02,2,4,作業内容,,,台,3,5000,-15003,,,,,,0,,,電気,【減】照明の減,');
  });

  it('月まとめ：同じ列で全日分（渡した順）。日報の無い日は出さない', () => {
    const d1 = sampleDaily();
    const d2 = sampleDaily({ report: report('2026-11-05', { lines: [report().lines[3]] }) });
    const rows = lines(buildDailyCsv([d1, buildEmptyDailyReport(site, '2026-11-03'), d2]));
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(1 + 12 + 1);
    expect(rows[13]).toBe('2026-11-05,3,5,車両,2t ダンプ,10km/L,km,42,170,714,,,,,,,,,,,残土運搬');
  });

  it('日報の無い日：見出しの行と「日報がありません」の 1 行（日付と種別だけ）', () => {
    expect(lines(buildDailyCsv([buildEmptyDailyReport(site, '2026-11-03')]))).toEqual([
      HEADER,
      '2026-11-03,,,日報がありません,,,,,,,,,,,,,,,,,',
    ]);
  });

  it('日報の無い月：日付の列は年月のまま。空のモデルが複数でも「日報がありません」は 1 行だけ', () => {
    expect(lines(buildDailyCsv([buildEmptyDailyReport(site, '2026-12')]))).toEqual([HEADER, '2026-12,,,日報がありません,,,,,,,,,,,,,,,,,']);
    expect(lines(buildDailyCsv([buildEmptyDailyReport(site, '2026-11-03'), buildEmptyDailyReport(site, '2026-11-04')]))).toEqual([
      HEADER,
      '2026-11-03,,,日報がありません,,,,,,,,,,,,,,,,,',
    ]);
  });

  it('モデルが無いときも「日報がありません」の 1 行（日付は空）', () => {
    expect(lines(buildDailyCsv([]))).toEqual([HEADER, ',,,日報がありません,,,,,,,,,,,,,,,,,']);
  });

  it('実際の日報がある月は、空の日を飛ばし「日報がありません」は出さない', () => {
    const rows = lines(buildDailyCsv([sampleDaily(), buildEmptyDailyReport(site, '2026-11-03')]));
    expect(rows).toHaveLength(1 + 12);
    expect(rows.some((r) => r.includes('日報がありません'))).toBe(false);
  });
});
