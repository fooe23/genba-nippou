import { describe, expect, it } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import { clientConfirmationSchema, isoToJstLocal, jstLocalToIso } from '@/lib/db/client-confirmation-schemas';

// 客先確認の記録（recordClientConfirmation の入力）。

const AT = '2026-11-03T14:30:00+09:00';

describe('clientConfirmationSchema', () => {
  it('確認者名・日時・メモを受け付ける（前後の空白は除く。メモは省略で空）', () => {
    expect(clientConfirmationSchema.parse({ confirmedBy: ' 施主 〇〇様 ', confirmedAt: AT, note: ' 現地で口頭確認 ' })).toEqual({
      confirmedBy: '施主 〇〇様',
      confirmedAt: AT,
      note: '現地で口頭確認',
    });
    expect(clientConfirmationSchema.parse({ confirmedBy: '〇〇様', confirmedAt: '2026-11-03T05:30:00.123Z' })).toEqual({
      confirmedBy: '〇〇様',
      confirmedAt: '2026-11-03T05:30:00.123Z',
      note: '',
    });
    expect(clientConfirmationSchema.safeParse({ confirmedBy: 'あ'.repeat(100), confirmedAt: AT, note: 'い'.repeat(500) }).success).toBe(true);
  });

  it('確認者名が無い・長すぎるときは日本語の文言で弾く', () => {
    expect(firstError(clientConfirmationSchema, { confirmedAt: AT })).toBe('確認者名を入力してください');
    expect(firstError(clientConfirmationSchema, { confirmedBy: '   ', confirmedAt: AT })).toBe('確認者名を入力してください');
    expect(firstError(clientConfirmationSchema, { confirmedBy: 'あ'.repeat(101), confirmedAt: AT })).toBe('確認者名は100文字以内で入力してください');
  });

  it('日時が正しくないときは弾く（時差の無い日時・日付だけ・空・文字）', () => {
    for (const confirmedAt of ['2026-11-03T14:30', '2026-11-03', '', 'きょう', undefined, '2026-13-03T14:30:00+09:00']) {
      expect(firstError(clientConfirmationSchema, { confirmedBy: '〇〇様', confirmedAt })).toBe('確認の日時が正しくありません');
    }
  });

  it('メモは 500 文字まで', () => {
    expect(firstError(clientConfirmationSchema, { confirmedBy: '〇〇様', confirmedAt: AT, note: 'あ'.repeat(501) })).toBe('メモは500文字以内で入力してください');
  });
});

describe('日時の入力欄（datetime-local・日本時間）との変換', () => {
  it('入力欄の値 → 日本時間の ISO（秒が無ければ :00）', () => {
    expect(jstLocalToIso('2026-11-03T14:30')).toBe('2026-11-03T14:30:00+09:00');
    expect(jstLocalToIso('2026-11-03T14:30:15')).toBe('2026-11-03T14:30:15+09:00');
    expect(clientConfirmationSchema.safeParse({ confirmedBy: '〇〇様', confirmedAt: jstLocalToIso('2026-11-03T14:30') }).success).toBe(true);
  });
  it('入力欄の値が空・形が違うときは空（検証で「日時が正しくありません」になる）', () => {
    expect(jstLocalToIso('')).toBe('');
    expect(jstLocalToIso('2026/11/03 14:30')).toBe('');
  });
  it('保存された日時（UTC）→ 日本時間の入力欄の値', () => {
    expect(isoToJstLocal('2026-11-03T05:30:00+00:00')).toBe('2026-11-03T14:30');
    expect(isoToJstLocal('2026-11-03T20:05:00Z')).toBe('2026-11-04T05:05');
    expect(isoToJstLocal('壊れた値')).toBe('');
  });
});
