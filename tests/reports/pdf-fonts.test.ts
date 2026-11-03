import { describe, it, expect } from 'vitest';
import { cjkBreaks } from '@/lib/pdf/fonts';

describe('cjkBreaks（PDF の改行位置）', () => {
  it('各文字の後に幅 0 の区切り（\'\'）を挟む。1 文字の語にも付ける（付けないとハイフンつきの改行になる）', () => {
    expect(cjkBreaks('日当')).toEqual(['日', '', '当', '']);
    expect(cjkBreaks('日')).toEqual(['日', '']);
    expect(cjkBreaks('𠮷野')).toEqual(['𠮷', '', '野', '']);
  });

  it('禁則：句読点・閉じ括弧の前では改行しない（前の文字とつなぐ）', () => {
    const parts = cjkBreaks('見積は後日提出との依頼。');
    expect(parts.slice(-2)).toEqual(['頼。', '']);
    expect(parts.some((p) => p.startsWith('。'))).toBe(false);
    expect(cjkBreaks('はい、そう！')).toEqual(['は', '', 'い、', '', 'そ', '', 'う！', '']);
    // 閉じ括弧と句読点が続いても、どちらの前でも改行しない
    expect(cjkBreaks('棚）。')).toEqual(['棚）。', '']);
    for (const c of Array.from('。、）」』，．：；！？')) {
      expect(cjkBreaks(`あ${c}い`)).toEqual([`あ${c}`, '', 'い', '']);
    }
  });

  it('禁則：開き括弧の後では改行しない（次の文字とつなぐ）。間の文字は 1 文字ずつ', () => {
    expect(cjkBreaks('（手入力）')).toEqual(['（手', '', '入', '', '力）', '']);
    expect(cjkBreaks('「棚」『扉』')).toEqual(['「棚」', '', '『扉』', '']);
    for (const c of Array.from('（「『')) {
      expect(cjkBreaks(`あ${c}い`)).toEqual(['あ', '', `${c}い`, '']);
    }
  });

  it('つないでも文字は欠けない（つなげると元の語）', () => {
    const word = '施主様より（2階）「クロス」を張替え。見積は後日、提出！';
    expect(cjkBreaks(word).join('')).toBe(word);
  });

  it('空白だけの語・空文字はそのまま', () => {
    expect(cjkBreaks(' ')).toEqual([' ']);
    expect(cjkBreaks('  ')).toEqual(['  ']);
    expect(cjkBreaks('')).toEqual(['']);
  });
});
