import 'server-only';
import { downloadAttachment, listAttachmentsForReport, listClientIssuePhotosOn } from '@/lib/db/attachments';
import { loadCurrentSignaturePng } from '@/lib/db/client-signature';
import type { Attachment } from '@/lib/db/attachments-schemas';
import { getReportKey, listIssuesByIds, listIssuesForReports } from '@/lib/db/reports';
import { loadDailyReportInput } from '@/lib/db/reports-data';
import { getSite, type Site } from '@/lib/db/sites';
import { renderClientDailyReportPdf, type ClientPhotoImage } from '@/lib/pdf/client-daily-report';
import { issueNumbers } from '@/lib/reports/change-model';
import { imageFormat, mapWithLimit } from '@/lib/reports/client-daily-images';
import { clientDailyPhotos, type ClientPhotoIssue } from '@/lib/reports/client-daily-sections';
import { buildDailyReport, buildEmptyDailyReport } from '@/lib/reports/daily-model';
import type { DailyClientConfirmation } from '@/lib/reports/types';

// 現場日報（お客様用）の PDF を、日報の中身・その日の写真（Storage から読む）・サインの画像から作る（サーバーだけ）。
// 読み取りはすべてログイン中の利用者の Supabase クライアント（RLS 前提）。協力会社のアカウントは帳票の Route Handler で
// 先に断っている。写真が読めなかったときは、その写真の枠に「写真を読み込めませんでした」と出して PDF は作る。

/** 写真を Storage から同時に読む数。 */
const DOWNLOAD_CONCURRENCY = 4;

export interface RenderClientDailyOptions {
  /**
   * お客様のサインの画像（PNG）。あればサイン欄の中に出す（サインを保存するときの PDF）。
   * 渡さなければ、日報に保存したサイン（取り消していないもの）を Storage から読んで出す（無ければ空のサイン欄）。
   */
  signaturePng?: Buffer;
  /** 客先確認（確認者・日時・メモ）を差し替える。サインを保存するとき、これから保存する内容を PDF に出すのに使う。 */
  confirmation?: DailyClientConfirmation;
  /** 脚注の出力日時（ISO）。既定は今。 */
  outputAt?: string;
}

/** 写真の件（件番号はその件を書いた日報の中での登録順。日報の件の番号と同じ数え方）。 */
async function loadPhotoIssues(issueIds: string[]): Promise<ClientPhotoIssue[]> {
  if (issueIds.length === 0) return [];
  const own = await listIssuesByIds(issueIds);
  const all = await listIssuesForReports([...new Set(own.map((i) => i.reportId))]);
  const numbers = issueNumbers(all);
  return all.map((i) => ({ id: i.id, reportDate: i.reportDate, kind: i.kind, body: i.body, number: numbers.get(i.id) ?? 0 }));
}

async function loadImage(a: Attachment | undefined): Promise<ClientPhotoImage['image']> {
  if (!a) return null;
  try {
    const data = await downloadAttachment(a);
    if (!data) return null;
    const format = imageFormat(data);
    return format ? { data, format } : null;
  } catch (e) {
    console.error('[renderClientDailyPdf] photo', a.id, e);
    return null;
  }
}

/**
 * その現場・その日のお客様用日報 PDF。日報が無い日は「日報がありません」だけの PDF。帳票の Route Handler から使う
 * （権限・削除済みの判定は呼び出し側）。
 */
export async function renderClientDailyPdfFor(site: Site, date: string, opts: RenderClientDailyOptions = {}): Promise<Buffer> {
  const input = await loadDailyReportInput(site, date);
  if (!input) return renderClientDailyReportPdf(buildEmptyDailyReport(site, date), { outputAt: opts.outputAt, signaturePng: opts.signaturePng });
  const built = buildDailyReport(input);
  const model = opts.confirmation ? { ...built, clientConfirmation: opts.confirmation } : built;
  const signaturePng = opts.signaturePng ?? (await loadCurrentSignaturePng(input.report.id));

  const [reportAttachments, issueAttachments] = await Promise.all([
    listAttachmentsForReport(input.report.id),
    listClientIssuePhotosOn(site.id, date),
  ]);
  const attachments = [...issueAttachments, ...reportAttachments];
  const issues = await loadPhotoIssues(issueAttachments.flatMap((a) => (a.issueId ? [a.issueId] : [])));
  const chosen = clientDailyPhotos(model, attachments, issues);

  const byId = new Map(attachments.map((a) => [a.id, a]));
  const photos = await mapWithLimit(chosen, DOWNLOAD_CONCURRENCY, async (p): Promise<ClientPhotoImage> => ({
    caption: p.caption,
    image: await loadImage(byId.get(p.attachmentId)),
  }));

  return renderClientDailyReportPdf(model, { outputAt: opts.outputAt, photos, signaturePng });
}

/**
 * 日報の id からお客様用日報 PDF を作る（サインを保存した時点の PDF など）。日報・現場が見えない（RLS）ときは例外。
 */
export async function renderClientDailyPdf(reportId: string, opts: RenderClientDailyOptions = {}): Promise<Buffer> {
  const key = await getReportKey(reportId);
  if (!key) throw new Error('日報が見つかりません');
  const site = await getSite(key.siteId);
  if (!site) throw new Error('現場が見つかりません');
  return renderClientDailyPdfFor(site, key.date, opts);
}
