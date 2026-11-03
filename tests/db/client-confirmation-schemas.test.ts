import { describe, expect, it } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import {
  clientConfirmationSchema,
  isoToJstLocal,
  jstLocalToIso,
  sameClientConfirmation,
  unchangedConfirmationResult,
  type ClientConfirmationColumns,
} from '@/lib/db/client-confirmation-schemas';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';

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

// 何も変えない記録は DB に書かない（ガードの例外は「3 列のどれかが実際に変わる」更新だけを通すため）。
describe('sameClientConfirmation / unchangedConfirmationResult', () => {
  const rec = (by: string | null, at: string | null, note: string | null): ClientConfirmationColumns => ({
    client_confirmed_by: by,
    client_confirmed_at: at,
    client_confirmed_note: note,
  });
  const NONE = rec(null, null, null);
  const DONE = rec('施主 〇〇様', '2026-11-03T05:30:00+00:00', '口頭');
  const V1 = '2026-11-03T06:00:00.000000+00:00';
  const V2 = '2026-11-03T07:00:00.000000+00:00';

  it('日時は時刻として比べる（DB の UTC 表記と +09:00 の入力は同じ）。空文字と null は同じ', () => {
    expect(sameClientConfirmation(DONE, rec('施主 〇〇様', '2026-11-03T14:30:00+09:00', '口頭'))).toBe(true);
    expect(sameClientConfirmation(rec('', null, ''), NONE)).toBe(true);
  });

  it('名前・日時・メモのどれかが違えば別の記録', () => {
    expect(sameClientConfirmation(DONE, rec('施主 △△様', '2026-11-03T14:30:00+09:00', '口頭'))).toBe(false);
    expect(sameClientConfirmation(DONE, rec('施主 〇〇様', '2026-11-03T14:31:00+09:00', '口頭'))).toBe(false);
    expect(sameClientConfirmation(DONE, rec('施主 〇〇様', '2026-11-03T14:30:00+09:00', null))).toBe(false);
    expect(sameClientConfirmation(NONE, DONE)).toBe(false);
  });

  it('同じ内容の記録し直し・記録の無い日報の取り消しは書かずに成功（版はそのまま）', () => {
    expect(unchangedConfirmationResult({ ...DONE, updated_at: V1 }, rec('施主 〇〇様', '2026-11-03T14:30:00+09:00', '口頭'), V1)).toEqual({
      ok: true,
      updatedAt: V1,
    });
    expect(unchangedConfirmationResult({ ...NONE, updated_at: V1 }, NONE, null)).toEqual({ ok: true, updatedAt: V1 });
  });

  it('書かない場合でも、画面の版が今の版と違えば stale（もう一度記録の案内）', () => {
    expect(unchangedConfirmationResult({ ...NONE, updated_at: V2 }, NONE, V1)).toEqual({
      ok: false,
      error: STALE_CONFIRMATION_MESSAGE,
      stale: true,
    });
    expect(STALE_CONFIRMATION_MESSAGE).toBe('他の端末で更新されています。画面を再読み込みしてから、もう一度記録してください。');
  });

  it('内容が変わるときは null（DB に書く）', () => {
    expect(unchangedConfirmationResult({ ...NONE, updated_at: V1 }, DONE, V1)).toBeNull();
    expect(unchangedConfirmationResult({ ...DONE, updated_at: V1 }, NONE, V1)).toBeNull();
  });
});
