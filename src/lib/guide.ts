import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';

// アプリ内ガイド。章は src/content/guide/<slug>.md に置き、下の一覧の順に目次へ並べる。

export const GUIDE_CHAPTERS: { slug: string; title: string }[] = [
  { slug: 'index', title: 'ガイドの使い方' },
  { slug: 'setup', title: '使い始める前の準備（管理者）' },
  { slug: 'input', title: '日報の入力手順' },
  { slug: 'approval', title: '提出と承認' },
  { slug: 'sites', title: '完了現場と削除' },
  { slug: 'summary', title: '集計の見方' },
  { slug: 'carryover', title: '前月繰越の考え方' },
  { slug: 'migration', title: '移行時の繰越初期値の登録' },
  { slug: 'excel', title: 'Excel 出力と帳票（PDF・CSV）' },
  { slug: 'pdf', title: 'PDF の見方' },
  { slug: 'changes', title: '追加・変更の精算' },
  { slug: 'estimate', title: '積算書の連携（第3計画で追記）' },
  { slug: 'budget', title: '実行予算と元請けの内訳' },
  { slug: 'photos', title: '写真・資料の添付' },
];

/** 一覧にない章を読もうとしたときに投げる。ページ側で notFound() にする。 */
export class GuideNotFound extends Error {
  constructor(slug: string) {
    super(`ガイドの章が見つかりません: ${slug}`);
    this.name = 'GuideNotFound';
  }
}

const GUIDE_DIR = path.join(process.cwd(), 'src', 'content', 'guide');

/** 章の Markdown を読み、HTML にして返す。一覧にない slug は GuideNotFound。 */
export async function loadChapter(slug: string): Promise<string> {
  // 一覧にあるものだけ読む（パス操作の入り込みを防ぐ）。
  if (!GUIDE_CHAPTERS.some((c) => c.slug === slug)) throw new GuideNotFound(slug);
  const source = await readFile(path.join(GUIDE_DIR, `${slug}.md`), 'utf-8');
  return await marked.parse(source, { async: true });
}
