import { describe, it, expect } from 'vitest';
import type { Issue } from '@/lib/db/reports';
import { formatCell, type SectionTable } from '@/lib/reports/cost-sections';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import {
  CLIENT_DAILY_TITLE,
  clientDailyConfirmation,
  clientDailyFooterText,
  clientDailyHeaderRows,
  clientDailyTables,
  NO_ISSUES_TODAY,
} from '@/lib/reports/client-daily-sections';
import { issues, lines, report, sampleDaily, site, withChanges } from './daily-fixture';

const text = (t: SectionTable) => t.rows.map((r) => r.map(formatCell));
const heads = (t: SectionTable) => t.columns.map((c) => c.label);

const issue = (over: Partial<Issue>): Issue => ({ ...issues[0], ...over });

/** やり直しを含む 4 件（登録順 1〜4）。 */
const fourIssues: Issue[] = [
  issue({ id: 'a', body: '棚を 2 台追加', kind: 'extra', instructedBy: '施主様', instructionMethod: 'oral' }),
  issue({ id: 'b', body: '自社の手直し', kind: 'rework', instructedBy: null, instructionMethod: null }),
  issue({ id: 'c', body: '照明を 3 台減', kind: 'minus', instructedBy: null, instructionMethod: 'phone' }),
  issue({ id: 'd', body: '待機 2 時間', kind: 'client_delay', instructedBy: '設計 山田', instructionMethod: null }),
];

describe('お客様用日報の見出し', () => {
  it('現場名・日付（曜日）・天候・作業責任者・作業時間（共通時間の開始〜終了）', () => {
    expect(clientDailyHeaderRows(sampleDaily())).toEqual([
      ['現場名', '〇〇邸新築工事'],
      ['日付', '2026/11/02（月）'],
      ['天候', '晴れ'],
      ['作業責任者', '大江'],
      ['作業時間', '08:00〜17:30'],
    ]);
  });

  it('共通時間が無ければ作業時間は空（—）', () => {
    const m = sampleDaily({ report: report('2026-11-02', { common: { start: null, end: null, breakMin: 30, gapMin: null } }) });
    expect(clientDailyHeaderRows(m)[4]).toEqual(['作業時間', null]);
  });

  it('題名と脚注', () => {
    expect(CLIENT_DAILY_TITLE).toBe('現場日報（お客様用）');
    expect(clientDailyFooterText('2026-11-03T01:00:00Z')).toBe('現場日報アプリ ― 現場日報（お客様用） 出力日時 2026/11/03 10:00');
  });
});

describe('お客様用日報の表', () => {
  it('本日の作業：区分／工種／施工内容／数量／単位／人工。減の数量は負、施工内容に【区分】を付けない', () => {
    const { work } = clientDailyTables(withChanges());
    expect(heads(work)).toEqual(['区分', '工種', '施工内容', '数量', '単位', '人工']);
    expect(text(work)).toEqual([
      ['契約内', '大工', '床下地, "1 階"', '20', 'm2', '2.0'],
      ['契約内', '', '片付け', '—', '', '0.5'],
      ['追加', '大工', '棚の追加', '2', '台', '1.0'],
      ['増', '大工', '棚板の増', '1', '枚', '0.5'],
      ['変更', '建具', '窓の変更', '1', '式', '0.5'],
      ['減', '電気', '照明の減', '-3', '台', '0.0'],
    ]);
    expect(work.boldRows).toEqual([2, 3, 4, 5]);
  });

  it('作業員 N 名・合計 M.M 人工（作業員が居なければ null）', () => {
    expect(clientDailyTables(sampleDaily()).workersLine).toBe('作業員 3 名・合計 2.0 人工');
    const noWorkers = sampleDaily({ report: report('2026-11-02', { lines: lines.filter((l) => l.kind !== 'labor') }) });
    expect(clientDailyTables(noWorkers).workersLine).toBeNull();
  });

  it('本日の追加・変更のご連絡：件（MM/DD-番号）／種別／ご指示（指示者／方法）／内容。やり直しの件は出さない', () => {
    const { issues: t } = clientDailyTables(sampleDaily({ issues: fourIssues }));
    expect(heads(t)).toEqual(['件', '種別', 'ご指示（指示者／方法）', '内容']);
    expect(text(t)).toEqual([
      ['11/02-1', '追加指示', '施主様／口頭', '棚を 2 台追加'],
      ['11/02-3', '減', '電話', '照明を 3 台減'],
      ['11/02-4', '客先都合（手待ち・待機）', '設計 山田', '待機 2 時間'],
    ]);
  });

  it('件が無い日・やり直しだけの日は行が無い（PDF は「本日はありません」の 1 行）', () => {
    expect(NO_ISSUES_TODAY).toBe('本日はありません');
    expect(clientDailyTables(sampleDaily({ issues: [] })).issues.rows).toEqual([]);
    expect(clientDailyTables(sampleDaily({ issues: [fourIssues[1]] })).issues.rows).toEqual([]);
  });

  it('金額・作業員の氏名と時間・日当・労務費・車両・リース・購入・連絡事項・重要事項の本文は出さない', () => {
    const m = withChanges();
    const t = clientDailyTables(m);
    const all = [
      ...clientDailyHeaderRows(m).flat(),
      t.workersLine ?? '',
      ...[t.work, t.issues].flatMap((x) => [...heads(x), ...text(x).flat(), ...(x.total ?? []).map(formatCell)]),
    ].join('\n');
    for (const bad of [
      '日当', '労務費', '円', '¥', '金額', '原価', '出来高', '進捗',
      '田中', '鈴木', '佐藤', '07:00', '19:00',
      '2t ダンプ', '足場', '発電機', '釘', '合板', '山田商店',
      '100,000', '60,001', '15,003',
      m.notes, m.issues.text,
    ]) {
      expect(all).not.toContain(bad);
    }
  });
});

describe('お客様確認', () => {
  it('記録済み：確認者名・確認日時（サインは空）とメモ', () => {
    expect(clientDailyConfirmation(withChanges())).toEqual({
      boxes: [['確認者名', '施主 〇〇様'], ['確認日時', '2026/11/02 17:15'], ['サイン', '']],
      note: '棚の追加と窓の変更を現地で確認。照明は 3 台減で了承。',
    });
  });

  it('未記録：確認者名／日付／サイン の空欄 3 つ、メモなし', () => {
    expect(clientDailyConfirmation(sampleDaily())).toEqual({
      boxes: [['確認者名', ''], ['日付', ''], ['サイン', '']],
      note: null,
    });
  });

  it('日報の無い日のモデルでも表は空', () => {
    const t = clientDailyTables(buildEmptyDailyReport(site, '2026-11-04'));
    expect(t.work.rows).toEqual([]);
    expect(t.issues.rows).toEqual([]);
    expect(t.workersLine).toBeNull();
  });
});
