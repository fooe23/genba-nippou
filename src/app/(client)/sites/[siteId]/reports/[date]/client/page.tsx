import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { dateSchema } from '@/lib/db/masters-schemas';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { listAttachmentsForIssues, listAttachmentsForReport, listClientIssuePhotosOn, signedUrls } from '@/lib/db/attachments';
import { getClientSignatureState, signatureImageUrl } from '@/lib/db/client-signature';
import { getReport, getSignatureIssueSet, listIssuesByIds, listIssuesForReports, listOpenIssues } from '@/lib/db/reports';
import { clientIssueIdsForReport } from '@/lib/report/client-signature';
import { loadDailyReportInput } from '@/lib/db/reports-data';
import { getSite } from '@/lib/db/sites';
import { CHANGE_KIND_LABELS } from '@/lib/report/change-labels';
import { clientConfirmCandidates, initialSelection } from '@/lib/report/client-confirm';
import { issueNumbers } from '@/lib/reports/change-model';
import { clientDailyIssueList, clientDailyPhotos, clientDailyTables, type ClientListIssue } from '@/lib/reports/client-daily-sections';
import { cell, formatCell } from '@/lib/reports/cost-sections';
import { dailyDateLabel } from '@/lib/reports/daily-sections';
import { buildDailyReport } from '@/lib/reports/daily-model';
import { ClientConfirmView, type ClientConfirmIssue } from '@/components/report/ClientConfirmView';

// お客様用の確認画面（2026-11-13）。日報画面の「サインをもらう」から開き、スマホ・タブレットをお客様に渡して確認とサインをもらう。
// 社内の情報（日当・労務費・作業員の氏名と時間・買掛・燃料・リース・原価・金額・所属・会社名・連絡事項・社内の操作）は出さない。
// 出すのは 現場名・日付・天候、本日の施工内容、作業員の人数と人工の合計、確認していただく件、その日のお客様用の写真、
// 確認者・メモ・サインの枠だけ。ヘッダー・タブバーは (client) のレイアウトで出さない。
// 開ける人：その現場のメンバー（社員・管理者、その現場の協力会社。RLS で決まる）。日報の状態・完了現場は問わない。

export const metadata = { title: 'ご確認' };
// この画面から呼ぶ Server Action（お客様のサインの保存は写真入りの PDF を作る）の上限時間（秒）。
export const maxDuration = 60;

export default async function ClientConfirmPage({ params, searchParams }: PageProps<'/sites/[siteId]/reports/[date]/client'>) {
  const profile = await requireProfile();
  const { siteId, date } = await params;
  const sp = await searchParams;
  if (!isUuid(siteId) || !dateSchema.safeParse(date).success) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const backHref = `/sites/${siteId}/reports/${date}`;

  const report = await getReport(siteId, date);
  const input = report.head ? await loadDailyReportInput(site, date) : null;
  if (!report.head || !input) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <p role="alert" className="rounded-lg border border-amber-500 bg-amber-50 p-4 text-base font-bold text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          先に下書き保存してください。日報を保存すると、お客様用の確認画面を開けます。
        </p>
        <Link href={backHref} className="inline-flex min-h-11 items-center text-base font-medium text-blue-700 underline dark:text-blue-400">
          ← 日報の画面に戻る
        </Link>
      </main>
    );
  }
  const head = report.head;
  const reportId = head.id;
  const model = buildDailyReport(input);
  const showEstimate = isEmployeeOrAdmin(profile);

  const [signature, openIssues, reportAttachments, issuePhotos] = await Promise.all([
    getClientSignatureState(reportId),
    listOpenIssues(siteId),
    listAttachmentsForReport(reportId),
    listClientIssuePhotosOn(siteId, date),
  ]);
  const signed = signature?.current ?? null;
  // サイン済みの日報の件：そのサインで記録した件の一覧。記録の無い（第 4 段階より前の）サインはその日報の件。
  // お客様用日報 PDF（client-daily-render.ts）と同じ決め方（clientIssueIdsForReport）。
  const confirmedIds = signed
    ? clientIssueIdsForReport({
        signed: true,
        signedIssueSet: await getSignatureIssueSet(reportId),
        reportIssueIds: input.issues.map((i) => i.id),
      })
    : [];

  // 件番号（その件を書いた日報の中での登録順）を付けるため、関係する件の日報の件をまとめて読む
  const known = new Map([...input.issues, ...openIssues].map((i) => [i.id, i]));
  const extraIds = [...issuePhotos.flatMap((a) => (a.issueId ? [a.issueId] : [])), ...confirmedIds].filter((id) => !known.has(id));
  const extra = (await listIssuesByIds(extraIds)).filter((i) => i.siteId === siteId);
  const reportIds = [...new Set([...input.issues, ...openIssues, ...extra].map((i) => i.reportId))];
  const all = (await listIssuesForReports(reportIds)).filter((i) => i.siteId === siteId);
  const numbers = issueNumbers(all);
  const numbered: ClientListIssue[] = all.map((i) => ({
    id: i.id,
    reportDate: i.reportDate,
    kind: i.kind,
    body: i.body,
    status: i.status,
    number: numbers.get(i.id) ?? 0,
  }));
  const byId = new Map(numbered.map((i) => [i.id, i]));
  const pick = (list: { id: string }[]) => list.flatMap((i) => byId.get(i.id) ?? []);

  const candidates = signed ? [] : clientConfirmCandidates(pick(input.issues), pick(openIssues));
  const rowIssueIds = signed ? confirmedIds : candidates.map((c) => c.id);
  const attachmentsByIssue = await listAttachmentsForIssues(rowIssueIds);
  const toRow = (i: ClientListIssue): ClientConfirmIssue | null => {
    const row = clientDailyIssueList([i], attachmentsByIssue, [i.id])[0];
    return row ? { ...row, id: i.id } : null;
  };
  const issueRows = signed
    ? clientDailyIssueList(numbered, attachmentsByIssue, confirmedIds).map((r) => ({ ...r, id: r.number }))
    : candidates.flatMap((c) => toRow(c) ?? []);
  const focus = typeof sp.issue === 'string' ? sp.issue : null;
  const selected = [...initialSelection(candidates, focus)];

  // 写真：その日に付けた「お客様用 PDF に載せる」写真（お客様用日報 PDF と同じ選び方）
  const photoAttachments = [...issuePhotos, ...reportAttachments];
  const chosen = clientDailyPhotos(model, photoAttachments, numbered);
  const chosenIds = new Set(chosen.map((p) => p.attachmentId));
  const urls = chosen.length > 0 ? await signedUrls(photoAttachments.filter((a) => chosenIds.has(a.id))) : new Map<string, string>();
  const photos = chosen.map((p) => ({ id: p.attachmentId, url: urls.get(p.attachmentId) ?? '', caption: p.caption }));

  const { workersLine } = clientDailyTables(model);
  const workRows = model.work.rows.map((r) => ({
    kind: CHANGE_KIND_LABELS[r.changeKind],
    trade: r.trade,
    description: r.description,
    qty: formatCell(cell.qty(r.qty === null ? null : r.changeKind === 'minus' ? -r.qty : r.qty)),
    unit: r.unit,
  }));

  return (
    <ClientConfirmView
      siteId={siteId}
      reportId={reportId}
      expected={head.updatedAt}
      backHref={backHref}
      siteName={site.name}
      dateLabel={dailyDateLabel(date)}
      weather={model.header.weather}
      workRows={workRows}
      workersLine={workersLine}
      issues={issueRows}
      initialSelected={selected}
      showEstimate={showEstimate}
      photos={photos}
      defaultConfirmedBy={head.clientConfirmedBy ?? ''}
      defaultNote={head.clientConfirmedNote ?? ''}
      signed={
        signed
          ? {
              confirmedBy: signed.confirmedBy,
              signedAt: signed.signedAt,
              note: signed.note,
              imageUrl: await signatureImageUrl(signed.path),
            }
          : null
      }
    />
  );
}
