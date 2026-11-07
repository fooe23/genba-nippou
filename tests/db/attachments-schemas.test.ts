import { describe, expect, it } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import {
  attachmentErrorMessage,
  attachmentNameSchema,
  attachmentStorage,
  defaultClientVisible,
  fileExtension,
  fromAttachmentRow,
  linkInputSchema,
  linkUrlSchema,
  MAX_ATTACHMENT_BYTES,
  uploadInputSchema,
} from '@/lib/db/attachments-schemas';

// 日報・件の添付（写真・ファイル・リンク）の入力検証と、お客様用に載せるかの既定値。

const SITE = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';
const ISSUE = '33333333-3333-4333-8333-333333333333';
const ATT = '44444444-4444-4444-8444-444444444444';

const photo = { siteId: SITE, reportId: REPORT, kind: 'photo', name: 'IMG_0001.jpg', mime: 'image/jpeg', sizeBytes: 400_000 };
const pdf = { siteId: SITE, issueId: ISSUE, kind: 'file', name: '見積書.pdf', mime: 'application/pdf', sizeBytes: 1_000_000 };

describe('linkUrlSchema', () => {
  it('http・https だけ受け付ける（前後の空白は落とす）', () => {
    expect(linkUrlSchema.parse(' https://drive.google.com/drive/folders/abc ')).toBe('https://drive.google.com/drive/folders/abc');
    expect(linkUrlSchema.safeParse('http://example.com/a?b=1').success).toBe(true);
  });
  it('ほかのスキーム・URL でない文字・空は弾く', () => {
    for (const v of ['javascript:alert(1)', 'ftp://example.com/a', 'file:///etc/passwd', 'data:text/html,hi', 'drive.google.com/abc', '', '   ']) {
      expect(firstError(linkUrlSchema, v)).toBe('リンクは http:// か https:// で始まる URL を入力してください');
    }
    expect(firstError(linkUrlSchema, 'https://example.com/' + 'a'.repeat(2000))).toBe('リンクは2000文字以内で入力してください');
  });
});

describe('attachmentNameSchema', () => {
  it('名前は 1〜100 文字（前後の空白は落とす）', () => {
    expect(attachmentNameSchema.parse(' 図面フォルダ ')).toBe('図面フォルダ');
    expect(attachmentNameSchema.safeParse('あ'.repeat(100)).success).toBe(true);
    expect(firstError(attachmentNameSchema, '  ')).toBe('名前を入力してください');
    expect(firstError(attachmentNameSchema, 'あ'.repeat(101))).toBe('名前は100文字以内で入力してください');
  });
});

describe('linkInputSchema', () => {
  it('日報か件のどちらか一方に付ける', () => {
    expect(linkInputSchema.safeParse({ siteId: SITE, reportId: REPORT, url: 'https://a.example', name: 'G ドライブ' }).success).toBe(true);
    expect(linkInputSchema.safeParse({ siteId: SITE, issueId: ISSUE, url: 'https://a.example', name: 'G ドライブ', reportDate: '2026-11-09' }).success).toBe(true);
    expect(firstError(linkInputSchema, { siteId: SITE, url: 'https://a.example', name: 'x' })).toBe('添付先（日報か件）の指定が正しくありません');
    expect(firstError(linkInputSchema, { siteId: SITE, reportId: REPORT, issueId: ISSUE, url: 'https://a.example', name: 'x' })).toBe(
      '添付先（日報か件）の指定が正しくありません',
    );
  });
  it('日付は正しい日付だけ', () => {
    expect(firstError(linkInputSchema, { siteId: SITE, issueId: ISSUE, url: 'https://a.example', name: 'x', reportDate: '2026-02-30' })).not.toBeNull();
  });
});

describe('uploadInputSchema', () => {
  it('写真（image/*）とファイル（許可した種類）を受け付ける', () => {
    expect(uploadInputSchema.safeParse(photo).success).toBe(true);
    expect(uploadInputSchema.safeParse({ ...photo, mime: 'image/png', name: 'スクリーンショット.png' }).success).toBe(true);
    expect(uploadInputSchema.safeParse(pdf).success).toBe(true);
    const ok: [string, string][] = [
      ['a.pdf', 'application/pdf'],
      ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['a.xls', 'application/vnd.ms-excel'],
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.doc', 'application/msword'],
      ['a.JPG', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.png', 'image/png'],
    ];
    for (const [name, mime] of ok) expect(uploadInputSchema.safeParse({ ...pdf, name, mime }).success, name).toBe(true);
  });
  it('ファイルの mime が空なら拡張子から決める', () => {
    const r = uploadInputSchema.parse({ ...pdf, name: '見積.xls', mime: '' });
    expect(r.mime).toBe('application/vnd.ms-excel');
  });
  it('10MB を超えるもの・0 バイトは弾く', () => {
    expect(uploadInputSchema.safeParse({ ...pdf, sizeBytes: MAX_ATTACHMENT_BYTES }).success).toBe(true);
    expect(firstError(uploadInputSchema, { ...pdf, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })).toBe('1 つ 10MB までです');
    expect(firstError(uploadInputSchema, { ...photo, sizeBytes: 12 * 1024 * 1024 })).toBe('1 つ 10MB までです');
    expect(firstError(uploadInputSchema, { ...pdf, sizeBytes: 0 })).toBe('空のファイルは付けられません');
  });
  it('写真の mime は image/* だけ', () => {
    expect(firstError(uploadInputSchema, { ...photo, mime: 'application/pdf' })).toBe('写真は画像のファイルを選んでください');
    expect(firstError(uploadInputSchema, { ...photo, mime: '' })).toBe('写真は画像のファイルを選んでください');
  });
  it('許可していない拡張子・mime のファイルは弾く', () => {
    const msg = '付けられるファイルは PDF・Excel・Word・JPEG・PNG です';
    expect(firstError(uploadInputSchema, { ...pdf, name: 'a.exe', mime: 'application/octet-stream' })).toBe(msg);
    expect(firstError(uploadInputSchema, { ...pdf, name: 'a.zip', mime: 'application/zip' })).toBe(msg);
    expect(firstError(uploadInputSchema, { ...pdf, name: 'a.html', mime: 'text/html' })).toBe(msg);
    expect(firstError(uploadInputSchema, { ...pdf, name: '拡張子なし', mime: 'application/pdf' })).toBe(msg);
    // 拡張子と mime が合わない
    expect(firstError(uploadInputSchema, { ...pdf, name: 'a.pdf', mime: 'text/html' })).toBe(msg);
    expect(firstError(uploadInputSchema, { ...pdf, name: 'a.pdf', mime: 'image/png' })).toBe(msg);
  });
  it('日報か件のどちらか一方', () => {
    expect(firstError(uploadInputSchema, { ...photo, issueId: ISSUE })).toBe('添付先（日報か件）の指定が正しくありません');
  });
  it('リンクはアップロードの種類にならない', () => {
    expect(uploadInputSchema.safeParse({ ...photo, kind: 'link' }).success).toBe(false);
  });
});

describe('fileExtension・attachmentStorage', () => {
  it('拡張子は小文字で返す。無ければ null', () => {
    expect(fileExtension('見積書.PDF')).toBe('pdf');
    expect(fileExtension('a.b.xlsx')).toBe('xlsx');
    expect(fileExtension('README')).toBeNull();
    expect(fileExtension('.pdf')).toBeNull();
  });
  it('写真は gn-photos の .jpg、ファイルは gn-estimates の元の拡張子（パスは <現場>/att/<添付の id>）', () => {
    expect(attachmentStorage({ siteId: SITE, attachmentId: ATT, kind: 'photo', name: 'IMG.HEIC' })).toEqual({
      bucket: 'gn-photos',
      path: `${SITE}/att/${ATT}.jpg`,
    });
    expect(attachmentStorage({ siteId: SITE, attachmentId: ATT, kind: 'file', name: '見積書.PDF' })).toEqual({
      bucket: 'gn-estimates',
      path: `${SITE}/att/${ATT}.pdf`,
    });
  });
});

describe('defaultClientVisible', () => {
  it('件の写真は最初からお客様用に載せる、日報の写真は載せない', () => {
    expect(defaultClientVisible({ kind: 'photo', issueId: ISSUE })).toBe(true);
    expect(defaultClientVisible({ kind: 'photo', issueId: null })).toBe(false);
    expect(defaultClientVisible({ kind: 'photo' })).toBe(false);
  });
  it('ファイル・リンクは件でも載せない', () => {
    expect(defaultClientVisible({ kind: 'file', issueId: ISSUE })).toBe(false);
    expect(defaultClientVisible({ kind: 'link', issueId: ISSUE })).toBe(false);
    expect(defaultClientVisible({ kind: 'file' })).toBe(false);
  });
});

describe('attachmentErrorMessage', () => {
  it('DB の理由を利用者向けの文言にする', () => {
    expect(attachmentErrorMessage('report_locked')).toBe('提出した日報には添付を足せません（忘れたときは修正を申請してください）');
    expect(attachmentErrorMessage('issue_done')).toBe('完了した件には添付を足せません');
    expect(attachmentErrorMessage('file_not_allowed')).toBe('協力会社のアカウントではファイルを付けられません');
    expect(attachmentErrorMessage('site_closed')).toContain('完了（または削除）');
    expect(attachmentErrorMessage('not_attachment_owner')).toBe('付けた本人か管理者だけが消せます');
    expect(attachmentErrorMessage('something else')).toBeNull();
  });
  it('消すときは「消せません」の文言にする', () => {
    expect(attachmentErrorMessage('report_locked', 'delete')).toBe('提出した日報の添付は消せません（修正を申請してください）');
    expect(attachmentErrorMessage('issue_done', 'delete')).toBe('完了した件の添付は消せません');
  });
});

describe('fromAttachmentRow', () => {
  const row = {
    id: ATT, site_id: SITE, report_id: null, issue_id: ISSUE, kind: 'photo', storage_bucket: 'gn-photos',
    storage_path: `${SITE}/att/${ATT}.jpg`, url: null, name: '棚.jpg', caption: null, mime: 'image/jpeg', size_bytes: '300000',
    client_visible: true, attached_on: '2026-11-09', created_by: null, created_by_name: '山田', created_at: '2026-11-09T01:00:00+00:00',
  };
  it('行を画面用の形にする（大きさは数値、無い値は省く）', () => {
    expect(fromAttachmentRow(row)).toEqual({
      id: ATT, siteId: SITE, kind: 'photo', name: '棚.jpg', caption: '', clientVisible: true, attachedOn: '2026-11-09',
      createdBy: null, createdByName: '山田', createdAt: '2026-11-09T01:00:00+00:00', storageBucket: 'gn-photos',
      storagePath: `${SITE}/att/${ATT}.jpg`, mime: 'image/jpeg', sizeBytes: 300000, issueId: ISSUE,
    });
  });
  it('写真以外はお客様用に載せない扱い、知らない種類は読み飛ばす', () => {
    expect(fromAttachmentRow({ ...row, kind: 'link', url: 'https://a.example', storage_bucket: null, storage_path: null })?.clientVisible).toBe(false);
    expect(fromAttachmentRow({ ...row, kind: 'video' })).toBeNull();
  });
});
