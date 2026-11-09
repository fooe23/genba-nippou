'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BUDGET_FORBIDDEN_MESSAGE,
  BUDGET_SAVE_FAILED,
  budgetErrorMessage,
  budgetLinesInputSchema,
  contractItemsInputSchema,
  contractModeSchema,
  firstIssueMessage,
  progressPercentSchema,
  PROGRESS_FORBIDDEN_MESSAGE,
  siteIdSchema,
  tradeAliasInputSchema,
  tradeIdSchema,
  tradesInputSchema,
  type BudgetLineInput,
  type ContractItemInput,
  type ContractMode,
  type TradeInput,
} from '@/lib/budget/schemas';
import type { SiteTrade } from '@/lib/budget/types';
import { isPartnerSupplier, MSG_NOT_PARTNER } from '@/lib/calc/supplier-roles';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { loadSupplierRoles } from '@/lib/db/supplier-roles';
import { createServerSupabase } from '@/lib/supabase/server';

// 積算連携の書き込み（Server Actions）。社員・管理者だけ（協力会社は不可。DB の RLS・関数でも止める）。
// 完了・削除済みの現場は DB が断る（site_closed）。いずれも { ok, error } を返す（throw しない）。
// 内訳・予算の金額は DB のトリガーが round(数量 × 単価) で入れ直す（ここで計算した値は送らない）。

export type BudgetActionResult = { ok: true } | { ok: false; error: string };
export type SaveTradesResult = { ok: true; trades: SiteTrade[] } | { ok: false; error: string };

type DbError = { message: string; details?: string | null };

function dbErrorMessage(where: string, error: DbError): string {
  console.error(`[${where}]`, error.message);
  return budgetErrorMessage(error.message, error.details) ?? BUDGET_SAVE_FAILED;
}

function revalidateBudget(siteId: string): void {
  revalidatePath(`/sites/${siteId}`);
  revalidatePath(`/sites/${siteId}/budget`);
  revalidatePath(`/sites/${siteId}/budget/setup`);
}

/** 社員・管理者でなければ文言を返す。 */
async function staffError(): Promise<string | null> {
  const profile = await requireProfile();
  return isEmployeeOrAdmin(profile) ? null : BUDGET_FORBIDDEN_MESSAGE;
}

/** 請負・常用の会社がすべて協力会社の印のある会社か（DB のトリガー not_partner と同じ判定を先にして文言を出す）。 */
async function notPartnerLine(supabase: SupabaseClient, supplierIds: (string | null)[]): Promise<number | null> {
  const roles = await loadSupplierRoles(supabase, supplierIds.filter((v): v is string => v !== null));
  const index = supplierIds.findIndex((id) => id !== null && !isPartnerSupplier(roles, id));
  return index < 0 ? null : index;
}

/**
 * 現場の工種の一覧をまとめて保存する（trades は今の一覧の全部・並びの順。id が null の行は新しい工種）。
 * 一覧に無い工種は消す。日報・読み替え表・実行予算で使われている工種を消そうとすると全部やめて文言を返す。
 * 成功すれば保存後の一覧（id 付き）を返す。
 */
export async function saveTrades(siteId: string, trades: TradeInput[]): Promise<SaveTradesResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const site = siteIdSchema.safeParse(siteId);
  if (!site.success) return { ok: false, error: firstIssueMessage(site.error) };
  const parsed = tradesInputSchema.safeParse(trades);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error, '工種の') };
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('gn_save_site_trades', {
      p_site: site.data,
      p_trades: parsed.data.map((t) => ({ id: t.id, name: t.name })),
    });
    if (error) return { ok: false, error: dbErrorMessage('saveTrades', error) };
    const list = (Array.isArray(data) ? data : []) as { id: string; name: string; sort_order: number }[];
    revalidateBudget(site.data);
    return { ok: true, trades: list.map((t) => ({ id: t.id, name: t.name, sortOrder: Number(t.sort_order) })) };
  } catch (e) {
    console.error('[saveTrades]', e);
    return { ok: false, error: BUDGET_SAVE_FAILED };
  }
}

/** 実行予算の行を全部入れ替える（並びは配列の順）。失敗すれば前の予算がそのまま残る。 */
export async function replaceBudgetLines(siteId: string, lines: BudgetLineInput[]): Promise<BudgetActionResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const site = siteIdSchema.safeParse(siteId);
  if (!site.success) return { ok: false, error: firstIssueMessage(site.error) };
  const parsed = budgetLinesInputSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error, '実行予算の') };
  try {
    const supabase = await createServerSupabase();
    const bad = await notPartnerLine(supabase, parsed.data.map((l) => l.supplierId));
    if (bad !== null) return { ok: false, error: `実行予算の${bad + 1}行目：${MSG_NOT_PARTNER}` };
    const { error } = await supabase.rpc('gn_replace_budget_lines', {
      p_site: site.data,
      p_lines: parsed.data.map((l) => ({
        trade_id: l.tradeId,
        performer: l.performer,
        supplier_id: l.supplierId,
        item: l.item,
        note: l.note,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unitPrice,
      })),
    });
    if (error) return { ok: false, error: dbErrorMessage('replaceBudgetLines', error) };
    revalidateBudget(site.data);
    return { ok: true };
  } catch (e) {
    console.error('[replaceBudgetLines]', e);
    return { ok: false, error: BUDGET_SAVE_FAILED };
  }
}

/**
 * 元請けの内訳を入れる。mode：'replace'＝全部入れ替える、'appendChange'＝今の行の後ろに「変更」の行として足す
 * （区分は DB が「変更」にする）。
 */
export async function replaceContractItems(
  siteId: string,
  items: ContractItemInput[],
  mode: ContractMode,
): Promise<BudgetActionResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const site = siteIdSchema.safeParse(siteId);
  if (!site.success) return { ok: false, error: firstIssueMessage(site.error) };
  const m = contractModeSchema.safeParse(mode);
  if (!m.success) return { ok: false, error: firstIssueMessage(m.error) };
  const parsed = contractItemsInputSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error, '元請けの内訳の') };
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc('gn_replace_contract_items', {
      p_site: site.data,
      p_items: parsed.data.map((i) => ({
        section: i.section,
        name: i.name,
        spec: i.spec,
        qty: i.qty,
        unit: i.unit,
        unit_price: i.unitPrice,
        trade_id: i.tradeId,
        category: i.category,
      })),
      p_mode: m.data,
    });
    if (error) return { ok: false, error: dbErrorMessage('replaceContractItems', error) };
    revalidateBudget(site.data);
    return { ok: true };
  } catch (e) {
    console.error('[replaceContractItems]', e);
    return { ok: false, error: BUDGET_SAVE_FAILED };
  }
}

/** 読み替え表：日報の工種の文字を工種に割り当てる。tradeId が null なら割り当てを外す。 */
export async function setTradeAlias(siteId: string, tradeText: string, tradeId: string | null): Promise<BudgetActionResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const site = siteIdSchema.safeParse(siteId);
  if (!site.success) return { ok: false, error: firstIssueMessage(site.error) };
  const parsed = tradeAliasInputSchema.safeParse({ tradeText, tradeId });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { error } =
      v.tradeId === null
        ? await supabase.from('gn_trade_aliases').delete().eq('site_id', site.data).eq('trade_text', v.tradeText)
        : await supabase
            .from('gn_trade_aliases')
            .upsert({ site_id: site.data, trade_text: v.tradeText, trade_id: v.tradeId }, { onConflict: 'site_id,trade_text' });
    if (error) {
      // RLS の一般の拒否（完了現場・権限なし）は理由が分からないので、権限か完了の文言にする
      if (error.message.includes('row-level security')) return { ok: false, error: `${BUDGET_FORBIDDEN_MESSAGE}（完了した現場は変更できません）` };
      return { ok: false, error: dbErrorMessage('setTradeAlias', error) };
    }
    revalidateBudget(site.data);
    return { ok: true };
  } catch (e) {
    console.error('[setTradeAlias]', e);
    return { ok: false, error: BUDGET_SAVE_FAILED };
  }
}

/**
 * 工種の進み具合（%）を上書きする（履歴に 1 行足す。最新が有効）。percent が null なら上書きを消す（数量からに戻す）。
 * できるのは管理者と、この現場の確認者・承認者（社員）だけ（DB の RLS で判定）。
 */
export async function setTradeProgress(siteId: string, tradeId: string, percent: number | null): Promise<BudgetActionResult> {
  const profile = await requireProfile();
  if (!isEmployeeOrAdmin(profile)) return { ok: false, error: PROGRESS_FORBIDDEN_MESSAGE };
  const site = siteIdSchema.safeParse(siteId);
  if (!site.success) return { ok: false, error: firstIssueMessage(site.error) };
  const trade = tradeIdSchema.safeParse(tradeId);
  if (!trade.success) return { ok: false, error: firstIssueMessage(trade.error) };
  const p = progressPercentSchema.safeParse(percent);
  if (!p.success) return { ok: false, error: firstIssueMessage(p.error) };
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('gn_trade_progress')
      .insert({ site_id: site.data, trade_id: trade.data, percent: p.data });
    if (error) {
      // RLS の拒否＝管理者でも確認者・承認者でもない（または完了した現場）
      if (error.message.includes('row-level security')) return { ok: false, error: `${PROGRESS_FORBIDDEN_MESSAGE}（完了した現場は変更できません）` };
      return { ok: false, error: dbErrorMessage('setTradeProgress', error) };
    }
    revalidateBudget(site.data);
    return { ok: true };
  } catch (e) {
    console.error('[setTradeProgress]', e);
    return { ok: false, error: BUDGET_SAVE_FAILED };
  }
}
