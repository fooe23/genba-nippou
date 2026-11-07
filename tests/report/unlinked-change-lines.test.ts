import { describe, it, expect } from 'vitest';
import { unlinkedChangeLines, unlinkedChangeMessage, unlinkedChangeWarning } from '@/lib/report/unlinked-change-lines';
import type { ChangeKind } from '@/lib/types';

const work = (changeKind: ChangeKind, issueId: string | null, description = '作業') => ({ kind: 'work', changeKind, issueId, description });
const labor = { kind: 'labor' };

describe('unlinkedChangeLines', () => {
  it('追加・増・変更・減で件の無い行だけを、作業内容の行の番号つきで返す', () => {
    const lines = [labor, work('contract', null, '契約'), work('extra', null, '追加A'), work('increase', 'i1'), work('change', '', '変更B'), work('minus', null, '減C')];
    expect(unlinkedChangeLines(lines)).toEqual([
      { index: 1, row: 2, changeKind: 'extra', description: '追加A' },
      { index: 3, row: 4, changeKind: 'change', description: '変更B' },
      { index: 4, row: 5, changeKind: 'minus', description: '減C' },
    ]);
  });

  it('契約内は件が無くてもよい。全部に件があれば空', () => {
    expect(unlinkedChangeLines([work('contract', null), work('extra', 'i1'), work('minus', 'i2')])).toEqual([]);
    expect(unlinkedChangeLines([])).toEqual([]);
  });

  it('作業内容以外の行は数えない（行番号にも入れない）', () => {
    expect(unlinkedChangeLines([labor, labor, work('increase', null)])).toEqual([{ index: 0, row: 1, changeKind: 'increase', description: '作業' }]);
  });

  it('区分の無い行は契約内として扱う', () => {
    expect(unlinkedChangeLines([{ kind: 'work', issueId: null }])).toEqual([]);
  });
});

describe('文言', () => {
  it('提出を断る文言に行数を入れる', () => {
    expect(unlinkedChangeMessage(2)).toBe('件を選んでいない追加・増・変更・減の行があります（2 行）。作業内容の行で『根拠の件』を選んでから提出してください。');
  });
  it('注意は行番号を並べる。無ければ null', () => {
    expect(unlinkedChangeWarning(unlinkedChangeLines([work('extra', null), work('contract', null), work('minus', null)]))).toBe(
      '作業内容の 1・3 行目：追加・増・変更・減の行は『根拠の件』を選ばないと提出できません',
    );
    expect(unlinkedChangeWarning([])).toBeNull();
  });
});
