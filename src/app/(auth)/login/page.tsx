'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { APP_NAME, GYOMU_NIPPOU_URL } from '@/lib/constants';
import { createBrowserSupabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.status === 400
            ? 'メールアドレスまたはパスワードが違います'
            : '通信エラーが発生しました。しばらくしてからもう一度お試しください。',
        );
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('通信エラーが発生しました。しばらくしてからもう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <Image
          src="/logo.png"
          alt="オオホリ建託"
          width={322}
          height={199}
          priority
          className="mx-auto mb-4 h-auto w-40 dark:invert"
        />
        <h1 className="mb-6 text-center text-2xl font-bold">{APP_NAME}</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-lg border border-gray-400 bg-transparent px-3 text-base"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-lg border border-gray-400 bg-transparent px-3 text-base"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-lg bg-blue-700 text-base font-bold text-white disabled:opacity-60"
          >
            {loading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
        <div className="mt-6 space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>
            パスワードをお忘れの場合は、
            <a
              href={GYOMU_NIPPOU_URL}
              target="_blank"
              rel="noopener"
              className="font-medium text-blue-700 underline underline-offset-4 dark:text-blue-400"
            >
              業務日報アプリ
            </a>
            のログイン画面にある「パスワードを忘れた方」から再設定してください（同じメールアドレスとパスワードで両方にログインできます）。
          </p>
          <p>協力会社の方は、管理者に再設定を依頼してください。</p>
        </div>
      </div>
    </main>
  );
}
