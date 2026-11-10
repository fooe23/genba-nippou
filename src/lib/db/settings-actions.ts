'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/profile';
import { settingsInputSchema, type SettingsInput } from '@/lib/db/settings-schemas';
import { createServerSupabase } from '@/lib/supabase/server';

// 全社の設定の保存（管理者のみ。RLS でも update は管理者だけ）。本番では throw した文言が画面に届かないため { ok, error } を返す。

export type SettingsResult = { ok: true } | { ok: false; error: string };

const FAILED = '設定の保存に失敗しました。もう一度お試しください。';
const RATES_NOT_SAVED =
  '件の精算の率は保存できませんでした（ほかの設定は保存しました）。データベースの更新（update_2026-11-18_settlement_rates.sql）が済むまでは、既定の率（15.1%・12%・12%・8%）で計算します。';
const NO_ROW = '設定の行が見つかりません。データベースの更新（update_2026-11-03_labor_rule.sql）が済んでいるか確認してください。';

/** 設定の変更は、この後に保存した日報から効く（保存済みの日報は保存し直すまで変わらない）。 */
export async function updateSettings(input: SettingsInput): Promise<SettingsResult> {
  await requireAdmin();
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  // 件の精算の率（% のまま DB に入れる）。update_2026-11-18_settlement_rates.sql の前は列が無い
  // （PostgREST は PGRST204「列が見つからない」、Postgres は 42703）ので、率を除いて保存し直す。
  const rateColumns = {
    ...(v.legalWelfarePct !== undefined ? { legal_welfare_rate: v.legalWelfarePct } : {}),
    ...(v.materialExpensePct !== undefined ? { material_expense_rate: v.materialExpensePct } : {}),
    ...(v.leaseFuelExpensePct !== undefined ? { lease_fuel_expense_rate: v.leaseFuelExpensePct } : {}),
    ...(v.overheadProfitPct !== undefined ? { overhead_profit_rate: v.overheadProfitPct } : {}),
  };
  const base = {
    shotei_hours: v.shoteiHours,
    fixed_overtime_limit: v.fixedOvertimeLimit,
    overtime_multiplier: v.overtimeMultiplier,
    overtime_base_hours: v.overtimeBaseHours,
    default_common_start: v.defaultCommonStart,
    default_common_end: v.defaultCommonEnd,
    default_common_break_min: v.defaultCommonBreakMin,
    default_common_gap_min: v.defaultCommonGapMin,
    // 省略（undefined）された項目は変更しない。
    ...(v.companyName !== undefined ? { company_name: v.companyName } : {}),
    ...(v.companyContact !== undefined ? { company_contact: v.companyContact } : {}),
    ...(v.budgetDailyRate !== undefined ? { budget_daily_rate: v.budgetDailyRate } : {}),
  };
  try {
    const supabase = await createServerSupabase();
    const save = (values: Record<string, unknown>) => supabase.from('gn_settings').update(values).eq('id', 1).select('id');
    let { data, error } = await save({ ...base, ...rateColumns });
    let ratesSkipped = false;
    if (error && (error.code === 'PGRST204' || error.code === '42703') && Object.keys(rateColumns).length > 0) {
      ({ data, error } = await save(base));
      ratesSkipped = true;
    }
    if (error) console.error('[updateSettings]', error.message);
    // テーブルが無い（42P01）・行が無いときは、SQL の適用を案内する。
    if ((error && error.code === '42P01') || (!error && (!data || data.length === 0))) return { ok: false, error: NO_ROW };
    if (error) return { ok: false, error: FAILED };
    revalidatePath('/admin/masters');
    if (ratesSkipped) return { ok: false, error: RATES_NOT_SAVED };
    return { ok: true };
  } catch (e) {
    console.error('[updateSettings]', e);
    return { ok: false, error: FAILED };
  }
}
