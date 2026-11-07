import { describe, expect, it } from 'vitest';
import {
  canEditClientConfirmation,
  canRevokeSignature,
  canSign,
  checkSignaturePng,
  clientSignatureSchema,
  isBlankDrawing,
  isSignaturePathFor,
  parseSignatureHistory,
  parseSignedPdfQuery,
  signedPdfInline,
  REPORT_SIGNED_DELETE_MESSAGE,
  REVOKE_ADMIN_ONLY_MESSAGE,
  revokeReasonSchema,
  SIGNATURE_EMPTY_MESSAGE,
  SIGNATURE_EXISTS_MESSAGE,
  SIGNATURE_IMAGE_FAILED_MESSAGE,
  SIGNATURE_LOCKED_MESSAGE,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_TOO_LARGE_MESSAGE,
  signatureErrorMessage,
  signatureFormSchema,
  signaturePath,
  signedPdfPath,
} from '@/lib/report/client-signature';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';

const SITE = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '11111111-2222-4333-8444-555555555555';
const SIGN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REPORT = '99999999-8888-4777-8666-555555555555';

describe('サインの入力', () => {
  const ok = { confirmedBy: ' 施主 佐藤様 ', note: ' 手すり位置OK ', signaturePath: signaturePath(SITE, SIGN_ID) };

  it('確認者は前後の空白を落とし、メモは省略できる', () => {
    const r = clientSignatureSchema.safeParse(ok);
    expect(r.success && r.data).toEqual({ confirmedBy: '施主 佐藤様', note: '手すり位置OK', signaturePath: ok.signaturePath, issueIds: [] });
    const r2 = signatureFormSchema.safeParse({ confirmedBy: '佐藤様' });
    expect(r2.success && r2.data.note).toBe('');
  });

  it('確認者は 1〜100 文字', () => {
    expect(clientSignatureSchema.safeParse({ ...ok, confirmedBy: '   ' }).error?.issues[0].message).toBe('確認者名を入力してください');
    expect(clientSignatureSchema.safeParse({ ...ok, confirmedBy: 'あ'.repeat(100) }).success).toBe(true);
    expect(clientSignatureSchema.safeParse({ ...ok, confirmedBy: 'あ'.repeat(101) }).error?.issues[0].message).toBe(
      '確認者名は100文字以内で入力してください',
    );
  });

  it('メモは 500 文字まで', () => {
    expect(clientSignatureSchema.safeParse({ ...ok, note: 'あ'.repeat(500) }).success).toBe(true);
    expect(clientSignatureSchema.safeParse({ ...ok, note: 'あ'.repeat(501) }).success).toBe(false);
  });

  it('サインの画像のパスは <現場>/sign/<uuid>.png だけ', () => {
    expect(clientSignatureSchema.safeParse({ ...ok, signaturePath: `${SITE}/att/${SIGN_ID}.jpg` }).error?.issues[0].message).toBe(
      SIGNATURE_IMAGE_FAILED_MESSAGE,
    );
    expect(clientSignatureSchema.safeParse({ ...ok, signaturePath: `${SITE}/sign/../x.png` }).success).toBe(false);
    expect(isSignaturePathFor(SITE, signaturePath(SITE, SIGN_ID))).toBe(true);
    expect(isSignaturePathFor(OTHER, signaturePath(SITE, SIGN_ID))).toBe(false);
    expect(isSignaturePathFor('not-a-uuid', signaturePath(SITE, SIGN_ID))).toBe(false);
  });

  it('サインした時点の PDF の置き場所', () => {
    expect(signedPdfPath(SITE, REPORT, 1793930338123.7)).toBe(`${SITE}/signed/${REPORT}-1793930338123.pdf`);
  });
});

describe('空のサインの判定', () => {
  /** 白い w×h の RGBA。ink 個の点を黒にする。 */
  function canvas(w: number, h: number, ink: number): Uint8ClampedArray {
    const a = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let i = 0; i < ink; i++) {
      a[i * 4] = 17;
      a[i * 4 + 1] = 17;
      a[i * 4 + 2] = 17;
    }
    return a;
  }

  it('何も描いていない（白だけ）は空', () => {
    expect(isBlankDrawing(canvas(50, 20, 0))).toBe(true);
  });

  it('点が少なすぎるものは空、目安以上なら空でない', () => {
    expect(isBlankDrawing(canvas(50, 20, 19), 20)).toBe(true);
    expect(isBlankDrawing(canvas(50, 20, 20), 20)).toBe(false);
  });

  it('薄い色・透明な点は数えない', () => {
    const a = new Uint8ClampedArray(100 * 4).fill(255);
    for (let i = 0; i < 50; i++) a[i * 4 + 3] = 0; // 透明な白
    for (let i = 50; i < 100; i++) {
      a[i * 4] = 230; // 薄い灰色
      a[i * 4 + 1] = 230;
      a[i * 4 + 2] = 230;
    }
    expect(isBlankDrawing(a, 1)).toBe(true);
  });

  it('サーバーの PNG の確認：形・大きさ', () => {
    const png = new Uint8Array(500);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(checkSignaturePng(png)).toBeNull();
    expect(checkSignaturePng(png.slice(0, 50))).toBe(SIGNATURE_EMPTY_MESSAGE);
    expect(checkSignaturePng(new Uint8Array(500))).toBe(SIGNATURE_IMAGE_FAILED_MESSAGE);
    const big = new Uint8Array(SIGNATURE_MAX_BYTES + 1);
    big.set(png.slice(0, 8));
    expect(checkSignaturePng(big)).toBe(SIGNATURE_TOO_LARGE_MESSAGE);
  });
});

describe('サインの判定', () => {
  it('サインをもらえるのは保存済みの日報でサインが無いとき', () => {
    expect(canSign({ reportId: REPORT, signed: false })).toBe(true);
    expect(canSign({ reportId: REPORT, signed: true })).toBe(false);
    expect(canSign({ reportId: null, signed: false })).toBe(false);
  });

  it('取り消せるのは管理者だけ（サインがあるとき）', () => {
    expect(canRevokeSignature({ isAdmin: true, signed: true })).toBe(true);
    expect(canRevokeSignature({ isAdmin: false, signed: true })).toBe(false);
    expect(canRevokeSignature({ isAdmin: true, signed: false })).toBe(false);
  });

  it('サインがある間は客先確認の記録し直し・取り消しをしない', () => {
    expect(canEditClientConfirmation(true)).toBe(false);
    expect(canEditClientConfirmation(false)).toBe(true);
  });

  it('取り消しの理由は必須・500 文字まで', () => {
    expect(revokeReasonSchema.safeParse('  ').error?.issues[0].message).toBe('取り消しの理由を入力してください');
    expect(revokeReasonSchema.safeParse(' 確認者の名前の間違い ').data).toBe('確認者の名前の間違い');
    expect(revokeReasonSchema.safeParse('あ'.repeat(501)).success).toBe(false);
  });
});

describe('DB の拒否理由の文言', () => {
  it.each([
    ['stale_report', STALE_CONFIRMATION_MESSAGE],
    ['signature_exists', SIGNATURE_EXISTS_MESSAGE],
    ['signature_locked', SIGNATURE_LOCKED_MESSAGE],
    ['report_signed', REPORT_SIGNED_DELETE_MESSAGE],
    ['storage_object_missing', SIGNATURE_IMAGE_FAILED_MESSAGE],
    ['storage_object_not_owned', SIGNATURE_IMAGE_FAILED_MESSAGE],
    ['invalid_storage_path', SIGNATURE_IMAGE_FAILED_MESSAGE],
    ['storage_object_too_large', SIGNATURE_TOO_LARGE_MESSAGE],
    ['not_admin', REVOKE_ADMIN_ONLY_MESSAGE],
    ['invalid_revoke_reason', '取り消しの理由を入力してください（500文字以内）'],
    ['report_not_found', '日報が見つからないか、権限がありません'],
  ])('%s', (code, message) => {
    expect(signatureErrorMessage(`ERROR: ${code}`)).toBe(message);
  });

  it('知らない理由は汎用の文言', () => {
    expect(signatureErrorMessage('boom')).toBe('処理に失敗しました。もう一度お試しください。');
    expect(signatureErrorMessage(null)).toBe('処理に失敗しました。もう一度お試しください。');
  });
});

describe('取り消したサインの記録・PDF のクエリ', () => {
  it('形の違う要素は飛ばし、位置（index）はそのまま', () => {
    const h = parseSignatureHistory([
      { pdf_path: 'a.pdf', signed_at: '2026-11-06T07:20:00+00:00', confirmed_by: '佐藤様', revoked_at: '2026-11-07T00:00:00+00:00', reason: '名前違い' },
      null,
      { reason: '理由だけ' },
    ]);
    expect(h).toEqual([
      { index: 0, pdfPath: 'a.pdf', signedAt: '2026-11-06T07:20:00+00:00', confirmedBy: '佐藤様', revokedAt: '2026-11-07T00:00:00+00:00', reason: '名前違い' },
      { index: 2, pdfPath: null, signedAt: null, confirmedBy: '', revokedAt: null, reason: '理由だけ' },
    ]);
    expect(parseSignatureHistory(null)).toEqual([]);
  });

  it('report は uuid、history は番号', () => {
    expect(parseSignedPdfQuery(`http://x/api/reports/signed?report=${REPORT}`)).toEqual({ reportId: REPORT, history: null });
    expect(parseSignedPdfQuery(`http://x/api/reports/signed?report=${REPORT}&history=2`)).toEqual({ reportId: REPORT, history: 2 });
    expect(parseSignedPdfQuery('http://x/api/reports/signed?report=abc')).toHaveProperty('error');
    expect(parseSignedPdfQuery(`http://x/api/reports/signed?report=${REPORT}&history=-1`)).toHaveProperty('error');
  });
});

describe('signedPdfInline', () => {
  it('disposition=attachment のときだけ保存、それ以外は開く', () => {
    expect(signedPdfInline(`http://x/api/reports/signed?report=${REPORT}`)).toBe(true);
    expect(signedPdfInline(`http://x/api/reports/signed?report=${REPORT}&disposition=inline`)).toBe(true);
    expect(signedPdfInline(`http://x/api/reports/signed?report=${REPORT}&disposition=attachment`)).toBe(false);
    expect(signedPdfInline(`http://x/api/reports/signed?report=${REPORT}&disposition=foo`)).toBe(true);
  });
});
