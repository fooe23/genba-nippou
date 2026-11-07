import { describe, it, expect } from 'vitest';
import { lineIssuePrefill } from '@/lib/report/line-issue';
import type { WorkLine } from '@/lib/types';

const line = (o: Partial<WorkLine>) => ({ changeKind: 'extra' as const, trade: '大工', description: '棚の追加', instructedBy: '', instructionMethod: null, ...o });

describe('lineIssuePrefill（作業内容の行から件を作るときの初期値）', () => {
  it('種別は区分から（追加→追加指示、増→増、変更→仕様変更、減→減）', () => {
    expect(lineIssuePrefill(line({ changeKind: 'extra' })).kind).toBe('extra');
    expect(lineIssuePrefill(line({ changeKind: 'increase' })).kind).toBe('increase');
    expect(lineIssuePrefill(line({ changeKind: 'change' })).kind).toBe('change');
    expect(lineIssuePrefill(line({ changeKind: 'minus' })).kind).toBe('minus');
  });
  it('指示方法が「指示なし（現場判断）」なら現場判断（要協議）', () => {
    expect(lineIssuePrefill(line({ changeKind: 'increase', instructionMethod: 'site' })).kind).toBe('site_judgment');
  });
  it('件の内容は「工種／施工内容」（空の方は省く）。指示者・指示方法は行から写す', () => {
    expect(lineIssuePrefill(line({ instructedBy: ' 施主 山田様 ', instructionMethod: 'oral' }))).toEqual({
      kind: 'extra', body: '大工／棚の追加', instructedBy: '施主 山田様', instructionMethod: 'oral',
    });
    expect(lineIssuePrefill(line({ trade: ' ' })).body).toBe('棚の追加');
    expect(lineIssuePrefill(line({ description: '' })).body).toBe('大工');
  });
});
