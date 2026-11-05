import { describe, it, expect } from 'vitest';
import { buildChangeLedger } from '@/lib/reports/change-model';
import {
  CLIENT_CHANGE_TITLE,
  clientChangeDetail,
  clientChangeFooterText,
  clientChangeInfoRows,
  clientChangeIssues,
  clientChangeSummary,
  clientNotes,
  PENDING_NOTE,
} from '@/lib/reports/client-change-sections';
import { formatCell, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { CostReportInput, CostReportPeriod, SavedReportLine } from '@/lib/reports/types';
import { changeMeta, emptyChangeModel, RATES, sampleChangeModel, settledChangeModel, settledInput } from './cost-fixture';

const texts = (cells: Cell[]) => cells.map(formatCell);
const MONTH: CostReportPeriod = { kind: 'month', month: '2026-11' };

/** settledInput に、やり直しの件 iR に紐づく行を 1 行足したもの。 */
function withReworkLine(period: CostReportPeriod = { kind: 'all' }) {
  const input: CostReportInput = settledInput();
  const r = input.reports[1];
  const lines = r.lines as SavedReportLine[];
  const extra = lines.find((l) => l.kind === 'work' && l.description === '手すり追加')!;
  const rework = { ...extra, description: '巾木の手直し作業', issueId: 'iR' } as SavedReportLine;
  return buildChangeLedger({ ...input, reports: [input.reports[0], { ...r, lines: [...lines, rework] }] }, RATES, period);
}

const FORBIDDEN = ['実績原価', '見込み額', '提案額', '経費率', '利益率', '単価', '申告額'];
const allLabels = (tables: (SectionTable | null)[]) => tables.flatMap((t) => (t ? t.columns.map((c) => c.label) : []));
const allTexts = (tables: (SectionTable | null)[]) =>
  tables.flatMap((t) => (t ? [...t.rows, ...(t.total ? [t.total] : [])].flatMap((r) => texts(r)) : []));

describe('客先用の見出し・脚注', () => {
  it('題名は「追加・変更工事 精算のご提案（案）」、脚注は「現場日報アプリ ― 精算のご提案（案） 出力日時」', () => {
    expect(CLIENT_CHANGE_TITLE).toBe('追加・変更工事 精算のご提案（案）');
    expect(clientChangeFooterText(changeMeta())).toBe('現場日報アプリ ― 精算のご提案（案） 2026/11/10 10:23');
  });

  it('見出しの項目は現場名・工事番号・期間・出力日時', () => {
    const info = Object.fromEntries(clientChangeInfoRows(settledChangeModel(), changeMeta()));
    expect(info['現場名']).toBe('〇〇邸新築工事');
    expect(info['期間']).toBe('工期全体（2026/10/20〜2026/11/05）');
  });
});

describe('clientChangeSummary（精算のまとめ）', () => {
  it('項目／件数／金額(円)。当初・追加・増・変更・減（負）と精算提案額（見積中を除く）', () => {
    const t = clientChangeSummary(settledChangeModel());
    expect(t.columns.map((c) => c.label)).toEqual(['項目', '件数', '金額(円)']);
    expect(t.rows.map(texts)).toEqual([
      ['当初請負金額', '', '1,000,000'],
      ['追加', '1', '113,236'],
      ['増', '0', '0'],
      ['変更', '1', '15,000'],
      ['減', '1', '-20,000'],
    ]);
    expect(texts(t.total!)).toEqual(['精算提案額', '', '1,108,236']);
  });

  it('月は「金額（累計）(円)」', () => {
    const t = clientChangeSummary(settledChangeModel(MONTH));
    expect(t.columns[2].label).toBe('金額（累計）(円)');
  });

  it('契約未確定なら「当初見積（概算）」、当初金額が無ければ精算提案額は「—」', () => {
    const m = settledChangeModel();
    expect(clientChangeSummary({ ...m, settlement: { ...m.settlement, baseBasis: 'estimate' } }).rows[0][0]).toBe('当初見積（概算）');
    const none = clientChangeSummary({ ...m, settlement: { ...m.settlement, base: null, proposed: 999 } });
    expect(formatCell(none.rows[0][2])).toBe('—');
    expect(formatCell(none.total![2])).toBe('—');
  });
});

describe('clientNotes（注記）', () => {
  it('見積中の件が N 件あれば注記、無ければ出さない', () => {
    expect(PENDING_NOTE(1)).toBe('見積中の件（1 件）は金額に含めていません。確定しだい改めてご提示します。');
    expect(clientNotes(settledChangeModel())).toEqual([PENDING_NOTE(1)]);
    const m = settledChangeModel();
    const fixed = { ...m, issues: m.issues.filter((i) => i.id !== 'i1') };
    expect(clientNotes(fixed)).toEqual([]);
  });

  it('月は「件数・金額は月末までの累計です。」、当初金額が無ければ既存の注記', () => {
    expect(clientNotes(settledChangeModel(MONTH))).toContain('件数・金額は月末までの累計です。');
    const m = settledChangeModel();
    expect(clientNotes({ ...m, settlement: { ...m.settlement, base: null, proposed: null } })).toContain('当初金額が未設定のため算出できません');
  });
});

describe('clientChangeIssues（件ごとの内容）', () => {
  it('件／ご指示／精算／金額(円)／確認。見積中は「—」、減は負、やり直しの件は載せない', () => {
    const t = clientChangeIssues(settledChangeModel())!;
    expect(t.columns.map((c) => c.label)).toEqual(['件', 'ご指示', '精算', '金額(円)', '確認']);
    expect(t.rows.map(texts)).toEqual([
      ['11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。', '施主 〇〇様／口頭 11/02', '見積中', '—', 'なし'],
      ['11/05-1 追加指示 玄関収納の追加', '11/05', '一式（見積 11/08）', '100,000', 'あり'],
      ['11/05-2 仕様変更 棚の位置変更（常用）', '11/05', '常用 0.5人工 × ¥30,000', '15,000', 'あり'],
      ['11/05-3 減 外壁塗装の一部取りやめ', '11/05', '一式（見積 11/06）', '-20,000', 'あり'],
    ]);
    expect(t.total).toBeUndefined();
  });

  it('確定日の無い一式は「一式」、確定額の無い一式は「見積中」で ¥0 と出さない', () => {
    const m = settledChangeModel();
    const issues = m.issues.map((i) =>
      i.id === 'iL' ? { ...i, fixedOn: null } : i.id === 'iM' ? { ...i, fixedAmount: null, settled: 0 } : i,
    );
    const rows = clientChangeIssues({ ...m, issues })!.rows.map(texts);
    expect(rows[1][2]).toBe('一式');
    expect(rows[3].slice(2, 4)).toEqual(['見積中', '—']);
  });

  it('載せる件が無ければ null', () => {
    expect(clientChangeIssues(emptyChangeModel())).toBeNull();
    expect(clientChangeIssues(sampleChangeModel())!.rows).toHaveLength(1);
  });
});

describe('clientChangeDetail（作業の明細）', () => {
  it('11 列（単価・申告額・実績原価・提案額は無い）。減の数量は負', () => {
    const t = clientChangeDetail(settledChangeModel());
    expect(t.columns.map((c) => c.label)).toEqual(['日付', '区分', '工種', '施工内容', '数量', '単位', '人工', '指示者', '方法', '件', '確認']);
    expect(t.rows.map(texts)).toEqual([
      ['2026/11/05', '追加', '内装', 'クロス張替え（2 階洋室）', '30', 'm2', '1.5', '施主 〇〇様', '口頭', '11/02-1', 'あり'],
      ['2026/11/05', '変更', '大工', '棚の位置変更', '1', '式', '0.5', '', '電話', '11/05-2', 'あり'],
      ['2026/11/05', '減', '塗装', '外壁塗装の一部取りやめ', '-10', 'm2', '0.0', '設計 佐藤様', '書面', '11/05-3', 'あり'],
      ['2026/11/05', '追加', '大工', '手すり追加', '1', '式', '0.5', '', '', '', 'あり'],
    ]);
  });

  it('やり直しの件に紐づく行は出さない（件ごとの内容にもやり直しは無い）', () => {
    const m = withReworkLine();
    expect(m.rows.some((r) => r.issue?.kind === 'rework')).toBe(true);
    const detail = clientChangeDetail(m);
    expect(detail.rows.map((r) => r[3])).not.toContain('巾木の手直し作業');
    expect(detail.rows).toHaveLength(4);
    expect(allTexts([clientChangeIssues(m), detail]).some((v) => v.includes('やり直し') || v.includes('巾木'))).toBe(false);
  });
});

describe('客先用に社内の数字を出さない', () => {
  it('まとめ・件ごとの内容・明細の列見出しと行に、実績原価・見込み額・提案額・経費率・単価・申告額が無い', () => {
    for (const m of [settledChangeModel(), settledChangeModel(MONTH), withReworkLine(), sampleChangeModel()]) {
      const tables = [clientChangeSummary(m), clientChangeIssues(m), clientChangeDetail(m)];
      const labels = allLabels(tables);
      for (const word of FORBIDDEN) expect(labels.filter((l) => l.includes(word))).toEqual([]);
      const notes = clientNotes(m).join('');
      for (const word of ['実績原価', '経費率', '利益率']) expect(notes).not.toContain(word);
    }
  });
});
