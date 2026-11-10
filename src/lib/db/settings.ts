import 'server-only';
import { cache } from 'react';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ChangeRates } from '@/lib/reports/types';
import type { LaborRule, TimeSpec } from '@/lib/types';

// 全社の設定（gn_settings。1 行だけ、id = 1）の読み取り。書き込みは settings-actions.ts（管理者のみ）。

export interface Settings {
  /** 人工・残業の計算設定（Excel 雛形 V34 の「労務の計算設定」と同じ 4 つ）。 */
  rule: LaborRule;
  /** 新しい日報の共通時間の初期値（現場の既定が無いときに使う）。 */
  defaultCommon: TimeSpec;
  /**
   * 件の精算の提案額に掛ける率（法定福利費率・材料経費率・リース燃料経費率・諸経費率［利益含む］。0.151 = 15.1%）。
   * DB の列は %（15.1）で持ち、読むときに 100 で割る。
   */
  rates: ChangeRates;
  /** 提案書などに出す自社の名前・連絡先（未設定は null）。 */
  company: { name: string | null; contact: string | null };
  /** 予算の標準日当（実行予算の自社の労務の単価の初期値。円／人工）。 */
  budgetDailyRate: number;
  updatedAt: string | null;
  /** 最後に更新した人（profiles.id）。DB のトリガーが入れる。 */
  updatedBy: string | null;
}

/** gn_settings の列の既定と同じ。行が無い（SQL 未適用）・読めないときに使う。 */
export const DEFAULT_COMMON: TimeSpec = { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 };

/**
 * gn_settings の legal_welfare_rate・material_expense_rate・lease_fuel_expense_rate・overhead_profit_rate の既定（15.1・12・12・8 %）と同じ。
 * 列が無い（update_2026-11-18_settlement_rates.sql の前）ときもこの率で計算する。
 */
export const DEFAULT_RATES: ChangeRates = { legalWelfareRate: 0.151, materialExpenseRate: 0.12, leaseFuelExpenseRate: 0.12, overheadProfitRate: 0.08 };

/** gn_settings.budget_daily_rate の既定と同じ（update_2026-11-15_budget.sql）。 */
export const DEFAULT_BUDGET_DAILY_RATE = 20000;

export const DEFAULT_SETTINGS: Settings = {
  rule: { ...DEFAULT_LABOR_RULE },
  defaultCommon: { ...DEFAULT_COMMON },
  rates: { ...DEFAULT_RATES },
  company: { name: null, contact: null },
  budgetDailyRate: DEFAULT_BUDGET_DAILY_RATE,
  updatedAt: null,
  updatedBy: null,
};

interface SettingsRow {
  shotei_hours: number | string | null;
  fixed_overtime_limit: number | string | null;
  overtime_multiplier: number | string | null;
  overtime_base_hours: number | string | null;
  default_common_start: string | null;
  default_common_end: string | null;
  default_common_break_min: number | string | null;
  default_common_gap_min: number | string | null;
  updated_at: string | null;
  updated_by?: string | null;
  legal_welfare_rate?: number | string | null;
  material_expense_rate?: number | string | null;
  lease_fuel_expense_rate?: number | string | null;
  overhead_profit_rate?: number | string | null;
  company_name?: string | null;
  company_contact?: string | null;
  budget_daily_rate?: number | string | null;
}

const LEGACY_COLUMNS =
  'shotei_hours, fixed_overtime_limit, overtime_multiplier, overtime_base_hours, default_common_start, default_common_end, default_common_break_min, default_common_gap_min, updated_at';
// updated_by は update_2026-11-03c_master_import.sql、率と会社名は update_2026-11-04_change_tracking.sql で追加。
// 未適用（列が無い＝42703）なら、列の少ない方で順に読み直す（無い列は既定値）。
const COLUMNS_V2 = `${LEGACY_COLUMNS}, updated_by`;
// 古い率（overhead_rate・profit_rate）は 2026-11-18 から読まない（列は DB に残る）。
const COLUMNS_V3 = `${COLUMNS_V2}, company_name, company_contact`;
// budget_daily_rate は update_2026-11-15_budget.sql で追加。
const COLUMNS_V4 = `${COLUMNS_V3}, budget_daily_rate`;
// 件の精算の率は update_2026-11-18_settlement_rates.sql で追加。
export const SETTLEMENT_RATE_COLUMNS = ['legal_welfare_rate', 'material_expense_rate', 'lease_fuel_expense_rate', 'overhead_profit_rate'] as const;
const COLUMNS = `${COLUMNS_V4}, ${SETTLEMENT_RATE_COLUMNS.join(', ')}`;
const COLUMN_SETS = [COLUMNS, COLUMNS_V4, COLUMNS_V3, COLUMNS_V2, LEGACY_COLUMNS];

function numOr(v: number | string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** DB の %（15.1）→ 率（0.151）。浮動小数の誤差を落とす。無い・数でなければ fallback（率）。 */
function pctOr(v: number | string | null | undefined, fallback: number): number {
  const pct = numOr(v, NaN);
  return Number.isFinite(pct) ? Math.round(pct * 1e4) / 1e6 : fallback;
}

function intOrNull(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toSettings(r: SettingsRow): Settings {
  const d = DEFAULT_LABOR_RULE;
  return {
    rule: {
      shoteiHours: numOr(r.shotei_hours, d.shoteiHours),
      fixedOvertimeLimit: numOr(r.fixed_overtime_limit, d.fixedOvertimeLimit),
      overtimeMultiplier: numOr(r.overtime_multiplier, d.overtimeMultiplier),
      overtimeBaseHours: numOr(r.overtime_base_hours, d.overtimeBaseHours),
    },
    defaultCommon: {
      start: r.default_common_start || null,
      end: r.default_common_end || null,
      breakMin: intOrNull(r.default_common_break_min),
      gapMin: intOrNull(r.default_common_gap_min),
    },
    rates: {
      legalWelfareRate: pctOr(r.legal_welfare_rate, DEFAULT_RATES.legalWelfareRate),
      materialExpenseRate: pctOr(r.material_expense_rate, DEFAULT_RATES.materialExpenseRate),
      leaseFuelExpenseRate: pctOr(r.lease_fuel_expense_rate, DEFAULT_RATES.leaseFuelExpenseRate),
      overheadProfitRate: pctOr(r.overhead_profit_rate, DEFAULT_RATES.overheadProfitRate),
    },
    company: { name: r.company_name || null, contact: r.company_contact || null },
    budgetDailyRate: numOr(r.budget_daily_rate, DEFAULT_BUDGET_DAILY_RATE),
    updatedAt: r.updated_at ?? null,
    updatedBy: r.updated_by ?? null,
  };
}

/** 全社の設定。1 リクエストにつき 1 回だけ問い合わせる。行が無い・読めないときは既定値。 */
export const getSettings = cache(async function getSettings(): Promise<Settings> {
  try {
    const supabase = await createServerSupabase();
    let { data, error } = await supabase.from('gn_settings').select(COLUMN_SETS[0]).eq('id', 1).maybeSingle();
    for (const columns of COLUMN_SETS.slice(1)) {
      if (!error || error.code !== '42703') break;
      ({ data, error } = await supabase.from('gn_settings').select(columns).eq('id', 1).maybeSingle());
    }
    if (error) {
      console.error('[gn_settings]', error.message);
      return structuredClone(DEFAULT_SETTINGS);
    }
    return data ? toSettings(data as unknown as SettingsRow) : structuredClone(DEFAULT_SETTINGS);
  } catch (e) {
    console.error('[gn_settings]', e);
    return structuredClone(DEFAULT_SETTINGS);
  }
});
