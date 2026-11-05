import { dateSchema } from '@/lib/db/masters-schemas';
import { fileNameStem } from '@/lib/export/payload';
import { MONTH_RE } from '@/lib/export/query';
import type { CostReportPeriod } from '@/lib/reports/types';
import { isUuid } from '@/lib/uuid';

// /api/reports/cost・/api/reports/daily・/api/reports/changes の入口まわりの純関数（Next・Supabase に依存しない）：クエリの検証と添付ファイル名。

export type CostFormat = 'pdf' | 'xlsx' | 'csv';
const FORMATS: readonly CostFormat[] = ['pdf', 'xlsx', 'csv'];

/** 'inline' はブラウザで開く（PDF のプレビュー）、'attachment' はファイルとして保存。 */
export type Disposition = 'inline' | 'attachment';

/** `disposition=inline` は PDF のときだけ inline。それ以外（xlsx・csv、指定なし・別の値）は attachment（エラーにしない）。 */
function readDisposition(params: URLSearchParams, format: string): Disposition {
  return format === 'pdf' && params.get('disposition') === 'inline' ? 'inline' : 'attachment';
}

/** `?site=<uuid>&period=all|YYYY-MM&format=pdf|xlsx|csv[&disposition=inline]` を読む。形式が違えばエラーの文。 */
export function parseCostQuery(
  url: URL | string,
): { siteId: string; period: CostReportPeriod; format: CostFormat; disposition: Disposition } | { error: string } {
  const params = (typeof url === 'string' ? new URL(url) : url).searchParams;
  const siteId = params.get('site') ?? '';
  const period = params.get('period') ?? '';
  const format = params.get('format') ?? '';
  if (!isUuid(siteId)) return { error: '現場の指定が正しくありません' };
  if (period !== 'all' && !MONTH_RE.test(period)) return { error: '集計期間の指定が正しくありません' };
  if (!(FORMATS as readonly string[]).includes(format)) return { error: '出力形式の指定が正しくありません' };
  return {
    siteId,
    period: period === 'all' ? { kind: 'all' } : { kind: 'month', month: period },
    format: format as CostFormat,
    disposition: readDisposition(params, format),
  };
}

/**
 * `現場名_工事原価集計表_YYYYMMDD.拡張子`（工期全体。日付は出力日）、月は `現場名_工事原価集計表_YYYY年MM月.拡張子`。
 * 現場名の禁止文字は原本 Excel と同じ規則（fileNameStem）。
 */
export function costReportFileName(siteName: string, period: CostReportPeriod, outputDate: string, ext: CostFormat): string {
  return periodFileName(siteName, '工事原価集計表', period, outputDate, ext);
}

/** `現場名_帳票名_YYYYMMDD.拡張子`（工期全体。日付は出力日）、月は `現場名_帳票名_YYYY年MM月.拡張子`。 */
function periodFileName(siteName: string, title: string, period: CostReportPeriod, outputDate: string, ext: string): string {
  const when = period.kind === 'all' ? outputDate.replaceAll('-', '') : `${period.month.slice(0, 4)}年${period.month.slice(5, 7)}月`;
  return `${fileNameStem(siteName)}_${title}_${when}.${ext}`;
}

// ─── 追加・変更の精算（/api/reports/changes）：客先用「精算のご提案」と「変更増減 社内確認用」 ───

export type ChangesFormat = 'pdf' | 'xlsx';

/** 帳票の宛先：'client' は客先に渡す資料（原価を出さない）、'internal' は社内確認用。 */
export type ReportAudience = 'client' | 'internal';

/** `audience=client` だけ客先用。指定なし・別の値は社内確認用（エラーにしない）。 */
function readAudience(params: URLSearchParams): ReportAudience {
  return params.get('audience') === 'client' ? 'client' : 'internal';
}

/**
 * `?site=<uuid>&period=all|YYYY-MM&format=pdf|xlsx[&disposition=inline][&audience=client]` を読む（工事原価集計表と同じ。
 * CSV は無い）。
 */
export function parseChangesQuery(
  url: URL | string,
):
  | { siteId: string; period: CostReportPeriod; format: ChangesFormat; disposition: Disposition; audience: ReportAudience }
  | { error: string } {
  const u = typeof url === 'string' ? new URL(url) : url;
  const query = parseCostQuery(u);
  if ('error' in query) return query;
  if (query.format === 'csv') return { error: '出力形式の指定が正しくありません' };
  return { ...query, format: query.format, audience: readAudience(u.searchParams) };
}

/**
 * 客先用 `現場名_精算のご提案_YYYYMMDD.拡張子`、社内確認用 `現場名_変更増減_社内確認用_YYYYMMDD.拡張子`
 * （月は `_YYYY年MM月`）。
 */
export function changeReportFileName(
  siteName: string,
  period: CostReportPeriod,
  outputDate: string,
  ext: ChangesFormat,
  audience: ReportAudience,
): string {
  return periodFileName(siteName, audience === 'client' ? '精算のご提案' : '変更増減_社内確認用', period, outputDate, ext);
}

// ─── 日報（/api/reports/daily） ───

export type DailyFormat = 'pdf' | 'csv';
const DAILY_FORMATS: readonly DailyFormat[] = ['pdf', 'csv'];

/** 1 日分（date）か月まとめ（month）。 */
export type DailyTarget = { kind: 'date'; date: string } | { kind: 'month'; month: string };

/**
 * `?site=<uuid>&date=YYYY-MM-DD&format=pdf|csv` または `?site=<uuid>&month=YYYY-MM&format=pdf|csv` を読む
 * （PDF は `&disposition=inline` でプレビュー）。
 */
export function parseDailyQuery(
  url: URL | string,
): { siteId: string; target: DailyTarget; format: DailyFormat; disposition: Disposition } | { error: string } {
  const params = (typeof url === 'string' ? new URL(url) : url).searchParams;
  const siteId = params.get('site') ?? '';
  const date = params.get('date') ?? '';
  const month = params.get('month') ?? '';
  const format = params.get('format') ?? '';
  if (!isUuid(siteId)) return { error: '現場の指定が正しくありません' };
  if ((date === '') === (month === '')) return { error: '日付か年月のどちらか一方を指定してください' };
  if (date !== '' && !dateSchema.safeParse(date).success) return { error: '日付の指定が正しくありません' };
  if (month !== '' && !MONTH_RE.test(month)) return { error: '年月の指定が正しくありません' };
  if (!(DAILY_FORMATS as readonly string[]).includes(format)) return { error: '出力形式の指定が正しくありません' };
  return {
    siteId,
    target: date !== '' ? { kind: 'date', date } : { kind: 'month', month },
    format: format as DailyFormat,
    disposition: readDisposition(params, format),
  };
}

/** `現場名_日報_YYYY-MM-DD.拡張子`、月まとめは `現場名_日報_YYYY年MM月.拡張子`（現場名は fileNameStem）。 */
export function dailyReportFileName(siteName: string, target: DailyTarget, ext: DailyFormat): string {
  const when = target.kind === 'date' ? target.date : `${target.month.slice(0, 4)}年${target.month.slice(5, 7)}月`;
  return `${fileNameStem(siteName)}_日報_${when}.${ext}`;
}
