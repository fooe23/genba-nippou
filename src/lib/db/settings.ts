import 'server-only';
import { cache } from 'react';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { createServerSupabase } from '@/lib/supabase/server';
import type { LaborRule, TimeSpec } from '@/lib/types';

// 全社の設定（gn_settings。1 行だけ、id = 1）の読み取り。書き込みは settings-actions.ts（管理者のみ）。

export interface Settings {
  /** 人工・残業の計算設定（Excel 雛形 V34 の「労務の計算設定」と同じ 4 つ）。 */
  rule: LaborRule;
  /** 新しい日報の共通時間の初期値（現場の既定が無いときに使う）。 */
  defaultCommon: TimeSpec;
  updatedAt: string | null;
  /** 最後に更新した人（profiles.id）。DB のトリガーが入れる。 */
  updatedBy: string | null;
}

/** gn_settings の列の既定と同じ。行が無い（SQL 未適用）・読めないときに使う。 */
export const DEFAULT_COMMON: TimeSpec = { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 };

export const DEFAULT_SETTINGS: Settings = { rule: { ...DEFAULT_LABOR_RULE }, defaultCommon: { ...DEFAULT_COMMON }, updatedAt: null, updatedBy: null };

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
}

const LEGACY_COLUMNS =
  'shotei_hours, fixed_overtime_limit, overtime_multiplier, overtime_base_hours, default_common_start, default_common_end, default_common_break_min, default_common_gap_min, updated_at';
// updated_by は update_2026-11-03c_master_import.sql で追加。未適用（列が無い＝42703）なら LEGACY_COLUMNS で読み直す。
const COLUMNS = `${LEGACY_COLUMNS}, updated_by`;

function numOr(v: number | string | null, fallback: number): number {
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
    updatedAt: r.updated_at ?? null,
    updatedBy: r.updated_by ?? null,
  };
}

/** 全社の設定。1 リクエストにつき 1 回だけ問い合わせる。行が無い・読めないときは既定値。 */
export const getSettings = cache(async function getSettings(): Promise<Settings> {
  try {
    const supabase = await createServerSupabase();
    let { data, error } = await supabase.from('gn_settings').select(COLUMNS).eq('id', 1).maybeSingle();
    if (error && error.code === '42703') {
      ({ data, error } = await supabase.from('gn_settings').select(LEGACY_COLUMNS).eq('id', 1).maybeSingle());
    }
    if (error) {
      console.error('[gn_settings]', error.message);
      return structuredClone(DEFAULT_SETTINGS);
    }
    return data ? toSettings(data as SettingsRow) : structuredClone(DEFAULT_SETTINGS);
  } catch (e) {
    console.error('[gn_settings]', e);
    return structuredClone(DEFAULT_SETTINGS);
  }
});
