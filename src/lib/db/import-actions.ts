'use server';

import { revalidatePath } from 'next/cache';
import { toImportCounts } from '@/lib/db/import';
import { importInputSchema, type ImportInput } from '@/lib/db/import-schemas';
import { requireAdmin } from '@/lib/db/profile';
import type { ImportCounts } from '@/lib/import/types';
import { createServerSupabase } from '@/lib/supabase/server';

// マスターの取り込み（管理者のみ）。ファイルは端末側で読み取り、選んだ行の JSON だけを受け取る。
// RPC gn_import_masters が 1 トランザクションで追加・更新・単価履歴・取り込み履歴を書く。

export type ImportResult = { ok: true; counts: ImportCounts } | { ok: false; error: string };

const FAILED = '取り込みに失敗しました。もう一度お試しください。';

export async function importMasters(input: ImportInput): Promise<ImportResult> {
  await requireAdmin();
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('gn_import_masters', {
      p_file_name: v.fileName,
      p_effective_from: v.effectiveFrom,
      p_payload: v.payload,
    });
    if (error) {
      console.error('[importMasters]', error.message);
      if (error.message.includes('not_admin')) return { ok: false, error: '管理者権限が必要です' };
      return { ok: false, error: FAILED };
    }
    revalidatePath('/admin/masters');
    return { ok: true, counts: toImportCounts(data) };
  } catch (e) {
    console.error('[importMasters]', e);
    return { ok: false, error: FAILED };
  }
}
