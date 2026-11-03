'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/db/profile';
import { settingsInputSchema, type SettingsInput } from '@/lib/db/settings-schemas';
import { createServerSupabase } from '@/lib/supabase/server';

// 全社の設定の保存（管理者のみ。RLS でも update は管理者だけ）。本番では throw した文言が画面に届かないため { ok, error } を返す。

export type SettingsResult = { ok: true } | { ok: false; error: string };

const FAILED = '設定の保存に失敗しました。もう一度お試しください。';
const NO_ROW = '設定の行が見つかりません。データベースの更新（update_2026-11-03_labor_rule.sql）が済んでいるか確認してください。';

/** 設定の変更は、この後に保存した日報から効く（保存済みの日報は保存し直すまで変わらない）。 */
export async function updateSettings(input: SettingsInput): Promise<SettingsResult> {
  await requireAdmin();
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_settings')
      .update({
        shotei_hours: v.shoteiHours,
        fixed_overtime_limit: v.fixedOvertimeLimit,
        overtime_multiplier: v.overtimeMultiplier,
        overtime_base_hours: v.overtimeBaseHours,
        default_common_start: v.defaultCommonStart,
        default_common_end: v.defaultCommonEnd,
        default_common_break_min: v.defaultCommonBreakMin,
        default_common_gap_min: v.defaultCommonGapMin,
        // 省略（undefined）された項目は変更しない。
        ...(v.overheadRate !== undefined ? { overhead_rate: v.overheadRate } : {}),
        ...(v.profitRate !== undefined ? { profit_rate: v.profitRate } : {}),
        ...(v.companyName !== undefined ? { company_name: v.companyName } : {}),
        ...(v.companyContact !== undefined ? { company_contact: v.companyContact } : {}),
      })
      .eq('id', 1)
      .select('id');
    if (error) console.error('[updateSettings]', error.message);
    // テーブルが無い（42P01）・行が無いときは、SQL の適用を案内する。
    if ((error && error.code === '42P01') || (!error && (!data || data.length === 0))) return { ok: false, error: NO_ROW };
    if (error) return { ok: false, error: FAILED };
    revalidatePath('/admin/masters');
    return { ok: true };
  } catch (e) {
    console.error('[updateSettings]', e);
    return { ok: false, error: FAILED };
  }
}
