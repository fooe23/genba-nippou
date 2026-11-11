import type { Site } from '@/lib/db/sites';
import type { SiteMoneyFields } from '@/lib/sites/display';

// 現場（gn_sites）の行を Site にする純関数（server-only を読まない。読み取り本体は src/lib/db/sites.ts）。

export interface SiteRow {
  id: string;
  name: string;
  client_name: string | null;
  project_name: string | null;
  project_no: string | null;
  overview: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_type: string | null;
  status: string;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | string | null;
  common_gap_min: number | string | null;
  deleted_at: string | null;
  contract_status: string | null;
  /** 見積提出が必須のお客様（2026-11-20）。SQL の前は読まない（undefined）。 */
  estimate_required?: boolean | null;
}

// お金の列（contract_amount・estimated_amount・default_daily_rate）は入れない。DB では authenticated に
// その列の SELECT が無い（update_2026-11-16_site_money.sql）ので、gn_sites は必ず列を名指しで読む（select('*') は失敗する）。
const SITE_FIELDS =
  'id, name, client_name, project_name, project_no, overview, start_date, end_date, contract_type, status, common_start, common_end, common_break_min, common_gap_min, deleted_at, contract_status';

/** 現場を読む列。withEstimate なら estimate_required も読む（列が無い DB［42703］では外して読み直す）。 */
export function siteColumns(withEstimate: boolean): string {
  return withEstimate ? `${SITE_FIELDS}, estimate_required` : SITE_FIELDS;
}

export function siteFromRow(r: SiteRow): Omit<Site, keyof SiteMoneyFields> {
  return {
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    projectName: r.project_name,
    projectNo: r.project_no,
    overview: r.overview,
    startDate: r.start_date,
    endDate: r.end_date,
    contractType: r.contract_type === '元請け' || r.contract_type === '下請' || r.contract_type === '常用' ? r.contract_type : null,
    status: r.status === 'done' ? 'done' : 'active',
    commonStart: r.common_start || null,
    commonEnd: r.common_end || null,
    commonBreakMin: r.common_break_min === null || r.common_break_min === undefined ? null : Number(r.common_break_min),
    commonGapMin: r.common_gap_min === null || r.common_gap_min === undefined ? null : Number(r.common_gap_min),
    deletedAt: r.deleted_at ?? null,
    contractStatus: r.contract_status === 'tentative' ? 'tentative' : 'fixed',
    estimateRequired: r.estimate_required === undefined || r.estimate_required === null ? null : Boolean(r.estimate_required),
  };
}

/** 列が無い（SQL の前）エラーか。select は 42703、insert・update の値は PGRST204。 */
export function isMissingColumnError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}
