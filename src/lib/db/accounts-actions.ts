'use server';

import { revalidatePath } from 'next/cache';
import {
  accountTypeSchema,
  CREATE_FAILED,
  mapAdminActionError,
  partnerAccountSchema,
  partnerSupplierSchema,
  passwordSchema,
  RESET_FAILED,
  userIdSchema,
  type PartnerAccountInput,
} from '@/lib/db/accounts-schemas';
import { requireAdmin, toAccountType, type AccountType } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';
import { notPartnerError } from '@/lib/db/supplier-roles';

// アカウント管理（Server Actions）。管理者のみ。例外は投げず { ok, error } を返す。

export type AccountResult = { ok: true } | { ok: false; error: string };
export type CreateAccountResult = { ok: true; id: string } | { ok: false; error: string };

const UPDATE_FAILED = '区分の保存に失敗しました。もう一度お試しください。';

type InvokeResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string | null };

/**
 * Edge Function admin-action を、管理者のセッションで呼ぶ。
 * 非2xx は FunctionsHttpError になるので、本文の JSON の error を取り出して返す。
 */
async function invokeAdminAction(body: Record<string, unknown>): Promise<InvokeResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.functions.invoke('admin-action', { body });
  if (error) {
    let message: string | null = null;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const json = (await context.json()) as { error?: unknown; message?: unknown };
        if (typeof json.error === 'string') message = json.error;
        else if (typeof json.message === 'string') message = json.message;
      } catch {
        // 本文が JSON でなければ message は null のまま（汎用の文言を出す）
      }
    }
    console.error('[admin-action]', error.message, message);
    return { ok: false, message };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (typeof payload.error === 'string') return { ok: false, message: payload.error };
  return { ok: true, data: payload };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 協力会社アカウントを作る。作成後に profiles の区分を partner・会社名にする。 */
export async function createPartnerAccount(input: PartnerAccountInput): Promise<CreateAccountResult> {
  await requireAdmin();
  const parsed = partnerAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  // 所属する協力会社は協力会社の印のある会社だけ（アカウントを作る前に確かめる）。
  if (v.supplierId) {
    const notPartner = await notPartnerError(await createServerSupabase(), v.supplierId);
    if (notPartner) return { ok: false, error: notPartner };
  }

  const res = await invokeAdminAction({
    action: 'create',
    email: v.email,
    password: v.password,
    name: v.name,
    emp_code: null,
    is_admin: false,
  });
  if (!res.ok) return { ok: false, error: mapAdminActionError(res.message, CREATE_FAILED) };
  const id = res.data.id;
  if (typeof id !== 'string' || !userIdSchema.safeParse(id).success) return { ok: false, error: CREATE_FAILED };

  // profiles の行は作成処理の直後にできる。念のため数回待って更新する。
  const supabase = await createServerSupabase();
  let updated = false;
  for (let attempt = 0; attempt < 3 && !updated; attempt++) {
    if (attempt > 0) await wait(400);
    const { data, error } = await supabase
      .from('profiles')
      .update({ account_type: 'partner', company_name: v.companyName })
      .eq('id', id)
      .select('id');
    if (error) console.error('[createPartnerAccount:update]', error.message);
    updated = !error && (data?.length ?? 0) > 0;
  }
  revalidatePath('/admin/accounts');
  if (!updated) {
    return {
      ok: false,
      error:
        'アカウントは作成されましたが区分の設定に失敗しました。現在は社員扱いで全現場が見えます。業務日報アプリにもログインできてしまうため、管理→アカウントで区分を協力会社に変更してください。',
    };
  }
  if (v.supplierId) {
    const { error } = await supabase
      .from('gn_partner_accounts')
      .upsert({ user_id: id, supplier_id: v.supplierId }, { onConflict: 'user_id' });
    if (error) {
      console.error('[createPartnerAccount:supplier]', error.message);
      return { ok: false, error: 'アカウントは作成されましたが、所属する協力会社の設定に失敗しました。管理→アカウントで設定してください。' };
    }
  }
  return { ok: true, id };
}

const SUPPLIER_FAILED = '所属する協力会社の保存に失敗しました。もう一度お試しください。';

/**
 * 協力会社アカウントの所属する協力会社（取引先）を設定する・外す（supplierId = null）。管理者のみ。
 * 結び付けは gn_partner_accounts（profiles は業務日報アプリと共有なので列を足さない）。協力会社アカウントだけ設定できる。
 */
export async function setPartnerSupplier(userId: string, supplierId: string | null): Promise<AccountResult> {
  await requireAdmin();
  const parsed = partnerSupplierSchema.safeParse({ userId, supplierId });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  const supabase = await createServerSupabase();
  if (v.supplierId === null) {
    const { error } = await supabase.from('gn_partner_accounts').delete().eq('user_id', v.userId);
    if (error) {
      console.error('[setPartnerSupplier:delete]', error.message);
      return { ok: false, error: SUPPLIER_FAILED };
    }
  } else {
    const { data, error: profileError } = await supabase.from('profiles').select('account_type').eq('id', v.userId).maybeSingle();
    if (profileError) {
      console.error('[setPartnerSupplier:profile]', profileError.message);
      return { ok: false, error: SUPPLIER_FAILED };
    }
    if (!data) return { ok: false, error: 'アカウントが見つかりません' };
    if (toAccountType((data as { account_type: unknown }).account_type) !== 'partner') {
      return { ok: false, error: '所属する協力会社は協力会社アカウントだけ設定できます' };
    }
    const notPartner = await notPartnerError(supabase, v.supplierId);
    if (notPartner) return { ok: false, error: notPartner };
    const { error } = await supabase
      .from('gn_partner_accounts')
      .upsert({ user_id: v.userId, supplier_id: v.supplierId }, { onConflict: 'user_id' });
    if (error) {
      console.error('[setPartnerSupplier:upsert]', error.message);
      return { ok: false, error: SUPPLIER_FAILED };
    }
  }
  revalidatePath('/admin/accounts');
  return { ok: true };
}

/** 協力会社アカウントのパスワードを再設定する（社員のパスワードは業務日報アプリで行う）。 */
export async function resetPartnerPassword(userId: string, password: string): Promise<AccountResult> {
  await requireAdmin();
  const id = userIdSchema.safeParse(userId);
  if (!id.success) return { ok: false, error: id.error.issues[0].message };
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) return { ok: false, error: pw.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('profiles').select('account_type').eq('id', id.data).maybeSingle();
  if (error) {
    console.error('[resetPartnerPassword:profile]', error.message);
    return { ok: false, error: RESET_FAILED };
  }
  if (!data) return { ok: false, error: 'アカウントが見つかりません' };
  if (toAccountType((data as { account_type: unknown }).account_type) !== 'partner') {
    return { ok: false, error: '協力会社アカウントのみ再設定できます。社員は業務日報アプリで再設定してください。' };
  }

  const res = await invokeAdminAction({ action: 'reset-password', user_id: id.data, password: pw.data });
  if (!res.ok) return { ok: false, error: mapAdminActionError(res.message, RESET_FAILED) };
  return { ok: true };
}

/** 社員⇄協力会社の区分と会社名を直す（管理者のみ）。 */
export async function updateAccountType(
  userId: string,
  accountType: AccountType,
  companyName: string | null,
): Promise<AccountResult> {
  const me = await requireAdmin();
  const parsed = accountTypeSchema.safeParse({ userId, accountType, companyName });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  const company = v.accountType === 'partner' ? (v.companyName ?? '') : '';
  if (v.accountType === 'partner' && company === '') return { ok: false, error: '協力会社の会社名を入力してください' };

  const supabase = await createServerSupabase();
  if (v.accountType === 'partner') {
    if (v.userId === me.id) return { ok: false, error: '自分自身を協力会社にはできません' };
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', v.userId)
      .maybeSingle();
    if (targetError) {
      console.error('[updateAccountType:profile]', targetError.message);
      return { ok: false, error: UPDATE_FAILED };
    }
    if (!target) return { ok: false, error: 'アカウントが見つかりません' };
    if ((target as { is_admin: boolean | null }).is_admin === true) {
      return { ok: false, error: '管理者は協力会社にできません。先に業務日報アプリで管理者権限を外してください。' };
    }
    // 協力会社は担当のみ。確認・承認の役割が残っていると矛盾するので止める。
    const { data: roles, error: rolesError } = await supabase
      .from('gn_site_members')
      .select('site_id')
      .eq('user_id', v.userId)
      .neq('role', 'staff')
      .limit(1);
    if (rolesError) {
      console.error('[updateAccountType:roles]', rolesError.message);
      return { ok: false, error: UPDATE_FAILED };
    }
    if ((roles ?? []).length > 0) {
      return { ok: false, error: '確認・承認の役割が割り当てられている現場があります。先に各現場の担当者で外すか、担当に変更してください。' };
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ account_type: v.accountType, company_name: v.accountType === 'partner' ? company : null })
    .eq('id', v.userId)
    .select('id');
  if (error) {
    console.error('[updateAccountType:update]', error.message);
    return { ok: false, error: UPDATE_FAILED };
  }
  if ((data ?? []).length === 0) return { ok: false, error: 'アカウントが見つかりません' };
  if (v.accountType === 'employee') {
    // 社員に戻したら、協力会社アカウントの所属する協力会社の結び付けも外す（区分の変更は済んでいるので失敗は記録だけ）。
    const { error: supplierError } = await supabase.from('gn_partner_accounts').delete().eq('user_id', v.userId);
    if (supplierError) console.error('[updateAccountType:supplier]', supplierError.message);
  }
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/sites/[siteId]', 'page');
  return { ok: true };
}
