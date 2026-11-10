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
import { changeMeta, emptyChangeModel, RATES, sampleChangeModel, settledChangeModel, settledInput, spanningChangeModel } from './cost-fixture';

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

const FORBIDDEN = ['実績原価', '見込み額', '提案額', '経費率', '利益率', '単価', '申告額', '法定福利', '諸経費', '内訳', '施工金額'];
const allLabels = (tables: (SectionTable | null)[]) => tables.flatMap((t) => (t ? t.columns.map((c) => c.label) : []));
const allTexts = (tables: (SectionTable | null)[]) =>
  tables.flatMap((t) =>
    t
      ? [
          ...[...t.rows, ...(t.total ? [t.total] : [])].flatMap((r) => texts(r)),
          ...(t.groups ?? []).flatMap((g) => [g.title, g.subtotal.label]),
        ]
      : [],
  );

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
      ['追加', '1', '107,459'],
      ['増', '0', '0'],
      ['変更', '1', '15,000'],
      ['減', '1', '-20,000'],
    ]);
    expect(texts(t.total!)).toEqual(['精算提案額', '', '1,102,459']);
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
      ['11/05-1 追加指示 玄関収納の追加', '11/05', '一式（11/08）', '100,000', 'あり'],
      ['11/05-2 仕様変更 棚の位置変更（常用）', '11/05', '常用 0.5人工 × ¥30,000', '15,000', 'あり'],
      ['11/05-3 減 外壁塗装の一部取りやめ', '11/05', '一式（11/06）', '-20,000', 'あり'],
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

  it('見積は「見積（MM/DD）」、見積日が無ければ「見積」、見積額が無ければ「見積中」。金額は一式と同じ', () => {
    const m = settledChangeModel();
    const est = (fixedOn: string | null) =>
      m.issues.map((i) => (i.id === 'iL' ? { ...i, settlementMethod: 'estimate' as const, fixedOn } : i));
    const rows = clientChangeIssues({ ...m, issues: est('2026-11-08') })!.rows.map(texts);
    expect(rows[1].slice(2, 4)).toEqual(['見積（11/08）', '100,000']);
    expect(clientChangeIssues({ ...m, issues: est(null) })!.rows.map(texts)[1][2]).toBe('見積');
    const pending = m.issues.map((i) => (i.id === 'iL' ? { ...i, settlementMethod: 'estimate' as const, fixedAmount: null, settled: 0 } : i));
    expect(clientChangeIssues({ ...m, issues: pending })!.rows.map(texts)[1].slice(2, 4)).toEqual(['見積中', '—']);
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

describe('clientChangeDetail（件ごとのまとまり）', () => {
  it('件ごとの内容と同じ並び（件の日報日・番号）、件なしは最後に「根拠の件なし」。見出しは件ごとの内容の件と同じ', () => {
    const m = spanningChangeModel();
    const t = clientChangeDetail(m);
    expect(t.groups!.map((g) => g.title)).toEqual([
      '11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。',
      '11/05-2 仕様変更 棚の位置変更（常用）',
      '11/05-3 減 外壁塗装の一部取りやめ',
      '根拠の件なし',
    ]);
    const issueNames = clientChangeIssues(m)!.rows.map((r) => r[0]);
    expect(t.groups!.slice(0, 3).map((g) => g.title).every((title) => issueNames.includes(title))).toBe(true);
  });

  it('2 日にまたがる件は 1 つのまとまりに日付順、小計「小計 2 日・3.5 人工」（人工の列に揃える）', () => {
    const t = clientChangeDetail(spanningChangeModel());
    const [first] = t.groups!;
    expect(first.rows.map((r) => [r[0], r[3], formatCell(r[6])])).toEqual([
      ['2026/11/05', 'クロス張替え（2 階洋室）', '1.5'],
      ['2026/11/06', 'クロス張替え（2 階洋室）', '2.0'],
    ]);
    expect(first.subtotal).toEqual({ label: '小計 2 日・3.5 人工', at: 6 });
    expect(t.columns[first.subtotal.at].label).toBe('人工');
    // rows はまとまりの行を順に並べたもの（「N 行」の数）
    expect(t.rows).toEqual(t.groups!.flatMap((g) => g.rows));
    expect(t.rows).toHaveLength(5);
  });

  it('やり直しの件のまとまりは出さない', () => {
    const t = clientChangeDetail(withReworkLine());
    expect(t.groups!.some((g) => g.title.includes('やり直し') || g.title.includes('巾木'))).toBe(false);
    expect(t.groups!.at(-1)!.title).toBe('根拠の件なし');
  });
});

describe('客先用に社内の数字を出さない', () => {
  it('まとめ・件ごとの内容・明細の列見出しと行に、実績原価・見込み額・提案額・経費率・単価・申告額が無い', () => {
    for (const m of [settledChangeModel(), settledChangeModel(MONTH), withReworkLine(), sampleChangeModel(), spanningChangeModel()]) {
      const tables = [clientChangeSummary(m), clientChangeIssues(m), clientChangeDetail(m)];
      const labels = allLabels(tables);
      for (const word of FORBIDDEN) expect(labels.filter((l) => l.includes(word))).toEqual([]);
      const notes = clientNotes(m).join('');
      for (const word of ['実績原価', '経費率', '利益率', '法定福利', '諸経費', '施工金額']) expect(notes).not.toContain(word);
    }
  });
});

describe('客先用に所属（自社・協力会社・会社名）を出さない', () => {
  const PARTNER = 'ひかり工務店';
  /** settledInput の労務の行を協力会社（請負）にし、自社の行も 1 行足したもの。 */
  function partnerModel(period: CostReportPeriod = { kind: 'all' }) {
    const input = settledInput();
    const reports = input.reports.map((r) => ({
      ...r,
      lines: [
        ...r.lines.map((l) => (l.kind === 'labor' ? ({ ...l, affiliation: 'partner', supplierId: 'pZ', laborContract: 'ukeoi' } as SavedReportLine) : l)),
        ...r.lines.filter((l) => l.kind === 'labor').map((l) => ({ ...l, workerId: 'w9', workerName: '山本 次郎', affiliation: 'own', supplierId: null } as SavedReportLine)),
      ],
    }));
    const suppliers = [
      ...input.suppliers,
      { ...input.suppliers[0], id: 'pZ', name: PARTNER, isVendor: false, isPartner: true },
    ];
    return buildChangeLedger({ ...input, reports, suppliers }, RATES, period);
  }

  it('まとめ・注記・件ごとの内容・明細（件ごとの見出し・小計を含む）に 所属／自社／協力会社／所属なし・会社名が無い', () => {
    for (const m of [partnerModel(), partnerModel(MONTH)]) {
      // 社内用の按分には所属が入っている（前提の確認）
      expect(m.rows.some((r) => r.affiliationManDays.some((a) => a.label === PARTNER))).toBe(true);
      const tables = [clientChangeSummary(m), clientChangeIssues(m), clientChangeDetail(m)];
      expect(clientChangeDetail(m).groups?.length).toBeGreaterThan(0);
      const words = [...allLabels(tables), ...allTexts(tables), ...clientNotes(m), ...clientChangeInfoRows(m, changeMeta()).flat().filter((v): v is string => v !== null)];
      for (const word of ['所属', '自社', '協力会社', '所属なし', PARTNER]) expect(words.filter((w) => w.includes(word))).toEqual([]);
    }
  });
});
