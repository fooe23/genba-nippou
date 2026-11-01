// 「押せる場所」を見た目で分かるようにする共通スタイル。
// 行やカード全体がリンクになっている一覧で使う（ホーム・完了現場・承認待ち・管理の現場一覧・ガイド）。
// 'use client' を付けない（サーバー部品からも文字列として使えるように）。

/** リンクの見出し文字：青・下線。 */
export const linkTitleClass =
  'text-blue-700 underline decoration-2 underline-offset-4 dark:text-blue-400';

/** 行・カード全体のリンク：押した瞬間に背景が変わる。 */
export const rowLinkClass = 'active:bg-blue-50 dark:active:bg-blue-950';

/** 右端の「›」。押すと次の画面に進むことを示す。 */
export function Chevron() {
  return (
    <span aria-hidden="true" className="shrink-0 pl-1 text-2xl leading-none text-blue-700 dark:text-blue-400">
      ›
    </span>
  );
}
