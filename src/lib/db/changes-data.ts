import 'server-only';
import { loadCostReportInput } from '@/lib/db/reports-data';
import { getSettings } from '@/lib/db/settings';
import type { Site } from '@/lib/db/sites';
import { buildChangeLedger } from '@/lib/reports/change-model';
import { changesTotal, joinChangesRows, type ChangesRow, type ChangesTotal } from '@/lib/reports/changes-page';

// 「追加・変更の一覧」画面の読み取り（RLS 前提）。権限・削除済みの判定は呼び出し側（ページ）で行う。

export interface ChangesPageData {
  rows: ChangesRow[];
  total: ChangesTotal;
  /** 現場の常用単価の既定（常用に切り替えたときの初期値）。 */
  defaultDailyRate: number | null;
}

/** 現場の全部の件と、工期全体の変更増減の台帳（件ごとの精算額）を合わせた一覧。 */
export async function loadChangesPage(site: Site): Promise<ChangesPageData> {
  const [input, settings] = await Promise.all([loadCostReportInput(site.id), getSettings()]);
  const ledger = buildChangeLedger(input, settings.rates, { kind: 'all' });
  const rows = joinChangesRows(input.issues, ledger);
  return { rows, total: changesTotal(rows), defaultDailyRate: site.defaultDailyRate };
}
