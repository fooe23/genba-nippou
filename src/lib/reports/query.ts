import { fileNameStem } from '@/lib/export/payload';
import { MONTH_RE } from '@/lib/export/query';
import type { CostReportPeriod } from '@/lib/reports/types';
import { isUuid } from '@/lib/uuid';

// /api/reports/cost の入口まわりの純関数（Next・Supabase に依存しない）：クエリの検証と添付ファイル名。

export type CostFormat = 'pdf' | 'xlsx' | 'csv';
const FORMATS: readonly CostFormat[] = ['pdf', 'xlsx', 'csv'];

/** `?site=<uuid>&period=all|YYYY-MM&format=pdf|xlsx|csv` を読む。形式が違えばエラーの文。 */
export function parseCostQuery(
  url: URL | string,
): { siteId: string; period: CostReportPeriod; format: CostFormat } | { error: string } {
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
  };
}

/**
 * `現場名_工事原価集計表_YYYYMMDD.拡張子`（工期全体。日付は出力日）、月は `現場名_工事原価集計表_YYYY年MM月.拡張子`。
 * 現場名の禁止文字は原本 Excel と同じ規則（fileNameStem）。
 */
export function costReportFileName(siteName: string, period: CostReportPeriod, outputDate: string, ext: CostFormat): string {
  const when = period.kind === 'all' ? outputDate.replaceAll('-', '') : `${period.month.slice(0, 4)}年${period.month.slice(5, 7)}月`;
  return `${fileNameStem(siteName)}_工事原価集計表_${when}.${ext}`;
}
