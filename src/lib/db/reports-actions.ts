'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { requireProfile } from '@/lib/db/profile';
import { getPreviousReport } from '@/lib/db/reports';
import { copyableLines, saveErrorMessage, toLineRows, toReportRow } from '@/lib/report/rows';
import { validateReport, type SaveInput } from '@/lib/report/schema';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ReportLine } from '@/lib/types';

// 日報の保存（Server Actions）。本番では throw した文言がクライアントに届かないため、
// 例外は投げずに { ok, error } を返す。

export type SaveReportResult = { ok: true; id: string } | { ok: false; error: string };
export type CopyPreviousResult =
  | { ok: true; date: string; lines: ReportLine[] }
  | { ok: false; error: string };

export async function saveReport(input: SaveInput): Promise<SaveReportResult> {
  await requireProfile();
  const checked = validateReport(input);
  if (!checked.ok) return { ok: false, error: checked.errors[0] };
  // 検証後の lines は正規化済み（金額のみ → qty=1・unitPrice=金額、amountOnly なし）。
  const v = checked.value;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('gn_save_report', {
      p_report: toReportRow(v),
      p_lines: toLineRows(v.lines, v.common),
    });
    if (error) {
      console.error('[gn_save_report]', error.message);
      return { ok: false, error: saveErrorMessage(error.message) };
    }
    revalidatePath('/');
    revalidatePath(`/sites/${v.siteId}`);
    revalidatePath(`/sites/${v.siteId}/reports/${v.date}`);
    return { ok: true, id: String(data) };
  } catch (e) {
    console.error('[saveReport]', e);
    return { ok: false, error: saveErrorMessage(null) };
  }
}

/** 前回の日報から作業員・車両・リースを複写する（個別時間・走行距離は空、リース数量はそのまま）。 */
export async function copyPreviousReport(siteId: string, date: string): Promise<CopyPreviousResult> {
  await requireProfile();
  if (!z.guid().safeParse(siteId).success || !dateSchema.safeParse(date).success) {
    return { ok: false, error: '現場または日付の指定が正しくありません' };
  }
  try {
    const prev = await getPreviousReport(siteId, date);
    if (!prev || !prev.head) return { ok: false, error: '前回の日報がありません' };
    return { ok: true, date: prev.head.reportDate, lines: copyableLines(prev.lines) };
  } catch (e) {
    console.error('[copyPreviousReport]', e);
    return { ok: false, error: '前回の日報を読み込めませんでした。通信状況を確認してもう一度お試しください。' };
  }
}
