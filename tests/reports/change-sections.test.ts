import { describe, it, expect } from 'vitest';
import {
  addressee,
  changeDetail,
  changeFooterText,
  changeInfoRows,
  changeIssues,
  changeSummary,
  reportSpan,
  senderRows,
} from '@/lib/reports/change-sections';
import { formatCell, type Cell } from '@/lib/reports/cost-sections';
import { changeMeta, emptyChangeModel, sampleChangeModel, settledChangeModel } from './cost-fixture';

const texts = (cells: Cell[]) => cells.map(formatCell);
const site = changeMeta().site;

describe('宛先・見出し', () => {
  it('客先名 ＋「御中」。客先名が無ければ「（客先名未設定）」（御中は付けない）', () => {
    expect(addressee(site)).toBe('〇〇様 御中');
    expect(addressee({ ...site, clientName: null })).toBe('（客先名未設定）');
    expect(addressee({ ...site, clientName: '  ' })).toBe('（客先名未設定）');
  });

  it('現場名・工事番号・期間（工期全体は最初〜最後の日報日、月は YYYY年MM月）・出力日時', () => {
    const all = Object.fromEntries(changeInfoRows(sampleChangeModel(), changeMeta()));
    expect(all['現場名']).toBe('〇〇邸新築工事');
    expect(all['工事番号']).toBe('K-001');
    expect(all['期間']).toBe('工期全体（2026/10/20〜2026/11/05）');
    expect(all['出力日時']).toBe('2026/11/10 10:23');
    expect('工事名' in all).toBe(false);

    const month = Object.fromEntries(changeInfoRows(sampleChangeModel({ kind: 'month', month: '2026-11' }), changeMeta()));
    expect(month['期間']).toBe('2026年11月');

    const none = Object.fromEntries(
      changeInfoRows(emptyChangeModel(), changeMeta({ site: { ...site, projectNo: null, projectName: '新築' }, reportSpan: { from: null, to: null } })),
    );
    expect(none['期間']).toBe('工期全体');
    expect(none['工事番号']).toBeNull();
    expect(none['工事名']).toBe('新築');
  });

  it('reportSpan：日報日の最初と最後（無ければ null）', () => {
    expect(reportSpan([{ reportDate: '2026-11-05' }, { reportDate: '2026-10-20' }, { reportDate: '2026-11-01' }])).toEqual({
      from: '2026-10-20',
      to: '2026-11-05',
    });
    expect(reportSpan([])).toEqual({ from: null, to: null });
  });
});

describe('changeSummary（サマリー表と注記）', () => {
  it('当初請負金額・契約内出来高・追加・増・変更・減（負）・精算提案額の順（行が無い区分も 0 で出す）', () => {
    const m = sampleChangeModel();
    const { table } = changeSummary(m);
    expect(table.columns.map((c) => c.label)).toEqual(['項目', '件数', '申告額(円)', '提案額(円)', '精算額(円)']);
    expect(table.rows.map((r) => r[0])).toEqual(['当初請負金額', '契約内出来高', '追加', '増', '変更', '減']);
    expect(texts(table.rows[0])).toEqual(['当初請負金額', '', '', '', '1,000,000']);
    expect(texts(table.rows[1])).toEqual(['契約内出来高', '', '', '', '200,000']);
    expect(texts(table.rows[2])).toEqual(['追加', '1', '36,000', '40,756', '40,756']);
    expect(texts(table.rows[3])).toEqual(['増', '0', '0', '0', '0']);
    expect(texts(table.rows[4])).toEqual(['変更', '1', '8,000', '13,586', '13,586']);
    expect(texts(table.rows[5])).toEqual(['減', '1', '-25,000', '-25,000', '-25,000']);
    expect(texts(table.total!)).toEqual(['精算提案額', '', '', '', '1,029,342']);
  });

  it('精算額の列は区分ごとの精算額（一式は確定額・常用は人工×単価。減は負）。精算提案額は精算額の合計から', () => {
    const { table } = changeSummary(settledChangeModel());
    expect(texts(table.rows[2])).toEqual(['追加', '2', '42,000', '52,942', '152,942']);
    expect(texts(table.rows[4])).toEqual(['変更', '1', '8,000', '13,236', '15,000']);
    expect(texts(table.rows[5])).toEqual(['減', '1', '-25,000', '-25,000', '-20,000']);
    expect(texts(table.total!)).toEqual(['精算提案額', '', '', '', '1,147,942']);
  });

  it('注記：精算額の決め方（やり直しは参考で合計に入れない）', () => {
    expect(changeSummary(sampleChangeModel()).notes).toContain(
      '精算額＝一式の件は確定額、常用の件は人工×常用単価、未定の件と件に紐づかない行は提案額。やり直しの件は参考で合計に入れません。',
    );
  });

  it('増の行：件数・申告額・提案額（モデルの summary.increase）', () => {
    const m = sampleChangeModel();
    const withIncrease = { ...m, summary: { ...m.summary, increase: { count: 2, declared: 12_000, actualCost: 10_000, proposal: 12_650, settled: 12_650 } } };
    expect(texts(changeSummary(withIncrease).table.rows[3])).toEqual(['増', '2', '12,000', '12,650', '12,650']);
  });

  it('契約未確定なら「当初見積（概算）」', () => {
    const m = sampleChangeModel();
    const tentative = { ...m, settlement: { ...m.settlement, baseBasis: 'estimate' as const } };
    expect(changeSummary(tentative).table.rows[0][0]).toBe('当初見積（概算）');
  });

  it('当初金額が無ければ精算提案額は「—」と注記', () => {
    const m = sampleChangeModel();
    const noBase = { ...m, settlement: { ...m.settlement, base: null, proposed: null } };
    const { table, notes } = changeSummary(noBase);
    expect(formatCell(table.rows[0][4])).toBe('—');
    expect(formatCell(table.total![4])).toBe('—');
    expect(notes).toContain('当初金額が未設定のため算出できません');
    expect(changeSummary(m).notes).not.toContain('当初金額が未設定のため算出できません');
  });

  it('注記に実際の経費率・利益率を入れる', () => {
    const [formula] = changeSummary(sampleChangeModel()).notes;
    expect(formula).toBe(
      '提案額＝実績原価×(1＋経費率 15%)×(1＋利益率 10%)、円未満切り上げ。減は申告額。実績原価＝投入人工×その日の平均日当＋その日の材料・リース・燃料を人工比で按分。',
    );
    const m = sampleChangeModel();
    expect(changeSummary({ ...m, rates: { overheadRate: 0.125, profitRate: 0 } }).notes[0]).toContain('(1＋経費率 12.5%)×(1＋利益率 0%)');
  });

  it('月は精算額の列を「精算額（累計）」、精算提案額に「（月末 までの累計）」を付け、当月分と累計の違いを注記', () => {
    const { table, notes } = changeSummary(sampleChangeModel({ kind: 'month', month: '2026-11' }));
    expect(table.columns.at(-1)!.label).toBe('精算額（累計）(円)');
    expect(table.total![0]).toBe('精算提案額（2026/11/30 までの累計）');
    expect(notes).toContain('件数・申告額・提案額と契約内出来高は当月分。精算額と精算提案額は月末までの累計です。');
    expect(changeSummary(sampleChangeModel()).notes.some((n) => n.includes('当月分'))).toBe(false);
  });
});

describe('changeDetail（明細一覧）', () => {
  it('15 列（実績原価は出さない）。日付（当月N回目）・区分・…・根拠の件・客先確認', () => {
    const t = changeDetail(sampleChangeModel());
    expect(t.columns.map((c) => c.label)).toEqual([
      '日付（当月N回目）', '区分', '工種', '施工内容', '数量', '単位', '単価(円)', '申告額(円)', '投入人工', '提案額(円)',
      '指示者', '指示方法', '指示日', '根拠の件', '客先確認',
    ]);
    expect(t.rows).toHaveLength(3);
  });

  it('追加：ラベル・指示方法・指示日・根拠の件（MM/DD-番号 種別 本文先頭）・客先確認', () => {
    const [extra] = changeDetail(sampleChangeModel()).rows;
    expect(texts(extra)).toEqual([
      '2026/11/05\n当月1回目', '追加', '内装', 'クロス張替え（2 階洋室）', '30', 'm2', '1,200', '36,000', '1.5', '40,756',
      '施主 〇〇様', '口頭', '2026/11/01', '11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。', 'あり',
    ]);
  });

  it('減：数量は負で表示、提案額は申告額（負）。未入力の指示者・根拠は空欄', () => {
    const [, change, minus] = changeDetail(sampleChangeModel()).rows;
    expect(formatCell(change[10])).toBe('');
    expect(formatCell(change[11])).toBe('電話');
    expect(formatCell(change[12])).toBe('');
    expect(formatCell(change[13])).toBe('');
    const m = texts(minus);
    expect(m[1]).toBe('減');
    expect(m[4]).toBe('-10');
    expect(m[7]).toBe('-25,000');
    expect(m[9]).toBe('-25,000');
    expect(m[11]).toBe('書面');
  });

  it('客先確認の無い日は「なし」', () => {
    const m = sampleChangeModel();
    const rows = changeDetail({ ...m, rows: m.rows.map((r) => ({ ...r, clientConfirmed: false })) }).rows;
    expect(rows.map((r) => r[14])).toEqual(['なし', 'なし', 'なし']);
  });

  it('変更行 0 件なら行なし', () => {
    expect(changeDetail(emptyChangeModel()).rows).toEqual([]);
  });
});

describe('changeIssues（件ごとの精算）', () => {
  const t = changeIssues(settledChangeModel())!;

  it('9 列：件・見込み額・精算方法・確定額・単価・確定日・行数・投入人工・提案額・精算額', () => {
    expect(t.columns.map((c) => c.label)).toEqual([
      '件', '見込み額(円)', '精算方法', '確定額・単価', '確定日', '行数', '投入人工', '提案額(円)', '精算額(円)',
    ]);
  });

  it('件の日付順に 1 行ずつ、最後に件なしの行。未定・一式・常用・減（負）・やり直し（参考）。件は「MM/DD-番号 種別 本文」（明細の根拠の件と同じ）', () => {
    expect(t.rows.map(texts)).toEqual([
      ['11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。', '40,000', '未定', '—', '', '1', '1.5', '39,706', '39,706'],
      ['11/05-1 追加指示 玄関収納の追加', '90,000', '一式', '100,000', '2026/11/08', '0', '0.0', '0', '100,000'],
      ['11/05-2 仕様変更 棚の位置変更（常用）', '—', '常用', '常用 0.5人工 × ¥30,000', '', '1', '0.5', '13,236', '15,000'],
      ['11/05-3 減 外壁塗装の一部取りやめ', '—', '一式', '-20,000', '2026/11/06', '1', '0.0', '-25,000', '-20,000'],
      ['11/05-4 やり直し 巾木の手直し', '—', '一式', '8,000', '', '0', '0.0', '0', '（参考）¥8,000'],
      ['件なし（根拠の件を選んでいない行）', '', '', '', '', '1', '0.5', '13,236', '13,236'],
    ]);
  });

  it('合計：行数・人工・提案額・精算額（やり直しは入れない。精算額の合計は区分ごとの精算額の合計と同じ）', () => {
    expect(texts(t.total!)).toEqual(['合計', '', '', '', '', '4', '2.5', '41,178', '147,942']);
    const s = settledChangeModel().settlement;
    expect(147_942).toBe(s.extra + s.increase + s.change + s.minus);
  });

  it('件なしの行は、件に紐づかない行があるときだけ', () => {
    const m = settledChangeModel();
    const rows = changeIssues({ ...m, unlinked: { lineCount: 0, manDays: 0, actualCost: 0, proposal: 0 } })!.rows;
    expect(rows.map((r) => r[0])).not.toContain('件なし（根拠の件を選んでいない行）');
    expect(rows).toHaveLength(5);
  });

  it('件も件なしの行も無ければ null（表を出さない）', () => {
    expect(changeIssues(emptyChangeModel())).toBeNull();
    const m = settledChangeModel();
    expect(changeIssues({ ...m, issues: [], unlinked: { lineCount: 0, manDays: 0, actualCost: 0, proposal: 0 } })).toBeNull();
    // 件が無くても件なしの行があれば出す
    expect(changeIssues({ ...m, issues: [] })!.rows.map((r) => r[0])).toEqual(['件なし（根拠の件を選んでいない行）']);
  });

  it('常用で単価が未入力なら「単価未入力」', () => {
    const m = settledChangeModel();
    const issues = m.issues.map((i) => (i.id === 'iD' ? { ...i, dailyRate: null, settled: 0 } : i));
    expect(formatCell(changeIssues({ ...m, issues })!.rows[2][3])).toBe('常用 0.5人工 × 単価未入力');
  });
});

describe('客先向けの表に実績原価を出さない', () => {
  it('サマリー・件ごとの精算・明細のどの列見出しにも「実績原価」が無い', () => {
    for (const m of [sampleChangeModel(), settledChangeModel(), settledChangeModel({ kind: 'month', month: '2026-11' })]) {
      const labels = [changeSummary(m).table, changeIssues(m)!, changeDetail(m)].flatMap((t) => t.columns.map((c) => c.label));
      expect(labels.filter((l) => l.includes('実績原価'))).toEqual([]);
    }
  });
});

describe('末尾・脚注', () => {
  it('会社名・担当者（出力した人）・連絡先。未設定は空欄', () => {
    expect(senderRows(changeMeta())).toEqual([
      ['会社名', '株式会社オオホリ建託'],
      ['担当者', '大江'],
      ['連絡先', 'TEL 000-000-0000'],
    ]);
    expect(senderRows(changeMeta({ company: { name: null, contact: null } }))).toEqual([
      ['会社名', ''],
      ['担当者', '大江'],
      ['連絡先', ''],
    ]);
  });

  it('脚注：現場日報アプリ ― 変更増減 精算資料（案） 出力日時', () => {
    expect(changeFooterText(changeMeta())).toBe('現場日報アプリ ― 変更増減 精算資料（案） 2026/11/10 10:23');
  });
});
