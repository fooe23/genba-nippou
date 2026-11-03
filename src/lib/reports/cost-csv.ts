import { toCsv } from '@/lib/reports/csv';
import { cellNumber, costSections, COST_REPORT_TITLE, headerRows, NO_REPORTS, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { CostReportModel } from '@/lib/reports/types';

// 工事原価集計表の CSV（純関数）。セクションごとに空行で区切った 1 ファイル。各セクションの 1 行目はセクション名、
// 続いて列見出し・明細・合計の行。金額は桁区切りなし、構成比などは % の数値（小数 1 桁）、「—」は空欄。

type Row = (string | number | null)[];

function csvCell(c: Cell): string | number | null {
  if (c === null || typeof c === 'string') return c;
  return c.value === null ? null : cellNumber(c.value, c.fmt, true);
}

function tableRows(t: SectionTable): Row[] {
  return [t.columns.map((c) => c.label), ...t.rows.map((r) => r.map(csvCell)), ...(t.total ? [t.total.map(csvCell)] : [])];
}

export function buildCostCsv(model: CostReportModel): string {
  const blocks: Row[][] = [[[COST_REPORT_TITLE], ...headerRows(model)]];
  const sections = costSections(model);
  if (sections.length === 0) {
    blocks.push([[NO_REPORTS]]);
  } else {
    for (const s of sections) blocks.push([s.note ? [s.title, s.note] : [s.title], ...s.tables.flatMap(tableRows)]);
    const sig = model.signature;
    blocks.push([['署名欄'], ['作成者', '確認者', '承認者'], [sig.createdBy, sig.checkedBy ?? '', sig.approvedBy ?? '']]);
  }
  const rows: Row[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) rows.push([]);
    rows.push(...b);
  });
  return toCsv(rows);
}
