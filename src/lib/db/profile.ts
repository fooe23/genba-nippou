import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export interface Profile {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

/** ログイン中のユーザーのプロフィール。未ログインは null。 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) console.error('[profiles]', error.message);
  if (!data) {
    return { id: user.id, name: '', email: user.email ?? '', isAdmin: false };
  }
  return {
    id: user.id,
    name: data.name ?? '',
    email: data.email ?? user.email ?? '',
    isAdmin: data.is_admin === true,
  };
}

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
