import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';

export type AccountType = 'employee' | 'partner';

/** DB の値を区分に直す（null・未知の値は employee）。 */
export function toAccountType(v: unknown): AccountType {
  return v === 'partner' ? 'partner' : 'employee';
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  /** 区分: 社員（業務日報と共通）／協力会社（現場日報専用）。 */
  accountType: AccountType;
  companyName: string | null;
}

/**
 * ログイン中のユーザーのプロフィール。未ログインは null。
 * React の cache() で1リクエストにつき1回だけ問い合わせる（レイアウトとページで共有）。
 */
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, is_admin, account_type, company_name')
    .eq('id', user.id)
    .maybeSingle();

  if (error) console.error('[profiles]', error.message);
  if (!data) {
    return { id: user.id, name: '', email: user.email ?? '', isAdmin: false, accountType: 'employee', companyName: null };
  }
  return {
    id: user.id,
    name: data.name ?? '',
    email: data.email ?? user.email ?? '',
    isAdmin: data.is_admin === true,
    accountType: toAccountType(data.account_type),
    companyName: data.company_name ?? null,
  };
});

/** 未ログインなら /login へ。 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  return profile;
}

/** 管理者以外は / へ。 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.isAdmin) redirect('/');
  return profile;
}

/** 社員か管理者か（協力会社は false）。DB の gn_is_employee_or_admin() と同じ判定。 */
export function isEmployeeOrAdmin(profile: Pick<Profile, 'isAdmin' | 'accountType'>): boolean {
  return profile.isAdmin || profile.accountType === 'employee';
}
