import { describe, expect, it } from 'vitest';
import { isManualRow, newLine, row, selectRow, toRows } from '@/components/report/form-state';
import type { LaborLine } from '@/lib/types';

const W = '11111111-1111-4111-8111-111111111111';

describe('手入力の行（作業員・仕入先の「（手入力）」）', () => {
  it('新しい空の行は未選択で、手入力ではない', () => {
    const r = row(newLine.labor());
    expect(isManualRow(r, r.line.workerId, r.line.workerName)).toBe(false);
  });

  it('「（手入力）」を選ぶと、氏名が空でも手入力の行になる（印は行に付き、選び直すと外れる）', () => {
    const rows = [row(newLine.labor()), row(newLine.labor())];
    const manual = selectRow(rows, 1, { workerId: null, workerName: '', dailyRate: null, overtimeRate: null }, true);
    expect(manual[0]).toBe(rows[0]);
    expect(manual[1].key).toBe(rows[1].key);
    expect(isManualRow(manual[1], manual[1].line.workerId, manual[1].line.workerName)).toBe(true);

    const master = selectRow(manual, 1, { workerId: W, workerName: '田中', dailyRate: 18000, overtimeRate: null }, false);
    expect(master[1].line).toMatchObject({ workerId: W, workerName: '田中', dailyRate: 18000 });
    expect(isManualRow(master[1], master[1].line.workerId, master[1].line.workerName)).toBe(false);
  });

  it('保存済み・前回コピー・下書きの、参照が無く氏名のある行は手入力として開く。参照のある行は手入力ではない', () => {
    const t = { start: null, end: null, breakMin: null, gapMin: null };
    const lines: LaborLine[] = [
      { kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time: t, dailyRate: 15000, note: '', overtimeRate: null },
      { kind: 'labor', workerId: W, workerName: '田中', time: t, dailyRate: 18000, note: '', overtimeRate: null },
    ];
    const [manual, master] = toRows(lines).labor;
    expect(isManualRow(manual, manual.line.workerId, manual.line.workerName)).toBe(true);
    expect(isManualRow(master, master.line.workerId, master.line.workerName)).toBe(false);
  });

  it('買掛：仕入先名のある参照なしの行は手入力', () => {
    const r = row({ ...newLine.credit(), vendor: '近所の資材店' });
    expect(isManualRow(r, r.line.supplierId, r.line.vendor)).toBe(true);
  });
});
