import { describe, it, expect } from 'vitest';
import { cjkBreaks } from '@/lib/pdf/fonts';

describe('cjkBreaks（PDF の改行位置）', () => {
  it('各文字の後に幅 0 の区切り（\'\'）を挟む。1 文字の語にも付ける（付けないとハイフンつきの改行になる）', () => {
    expect(cjkBreaks('日当')).toEqual(['日', '', '当', '']);
    expect(cjkBreaks('日')).toEqual(['日', '']);
    expect(cjkBreaks('𠮷野')).toEqual(['𠮷', '', '野', '']);
  });

  it('空白だけの語・空文字はそのまま', () => {
    expect(cjkBreaks(' ')).toEqual([' ']);
    expect(cjkBreaks('  ')).toEqual(['  ']);
    expect(cjkBreaks('')).toEqual(['']);
  });
});
