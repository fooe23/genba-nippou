import { requireProfile } from '@/lib/db/profile';

// お客様にスマホ・タブレットを渡して見せる画面のレイアウト（2026-11-13）。
// (app) のレイアウト（ヘッダーのアプリ名・ログイン中の名前・ログアウト、下のタブバー）を出さないため、別のルートグループにしている。
// URL は (app) と同じ並び（/sites/[siteId]/reports/[date]/client）。ログインは社内の画面と同じく必須。
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireProfile();
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
