import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// server-only は Next 外では import できないので空にする。
vi.mock('server-only', () => ({}));

const { GUIDE_CHAPTERS, GuideNotFound, loadChapter } = await import('@/lib/guide');

describe('ガイド', () => {
  it('章の順序と題名が決まりどおり', () => {
    expect(GUIDE_CHAPTERS.map((c) => c.slug)).toEqual([
      'index',
      'setup',
      'input',
      'approval',
      'sites',
      'summary',
      'carryover',
      'migration',
      'excel',
      'pdf',
      'estimate',
      'photos',
    ]);
    expect(GUIDE_CHAPTERS[0].title).toBe('ガイドの使い方');
    expect(GUIDE_CHAPTERS[1].title).toBe('使い始める前の準備（管理者）');
    expect(GUIDE_CHAPTERS[4].title).toBe('完了現場と削除');
    expect(GUIDE_CHAPTERS[6].title).toBe('前月繰越の考え方');
    expect(GUIDE_CHAPTERS[7].title).toBe('移行時の繰越初期値の登録');
  });

  it('すべての章のファイルがあり、HTMLに変換できる', async () => {
    for (const c of GUIDE_CHAPTERS) {
      expect(existsSync(path.join(process.cwd(), 'src/content/guide', `${c.slug}.md`)), c.slug).toBe(true);
      const html = await loadChapter(c.slug);
      expect(html, c.slug).toContain('<h1');
    }
  });

  it('前月繰越の章に必須の3点が入っている', async () => {
    const html = await loadChapter('carryover');
    expect(html).toContain('繰越の手作業は不要');
    expect(html).toContain('Excel出力');
    expect(html).toContain('繰越初期値');
  });

  it('移行の章がマスターシートのG・H列と繰越初期値に触れている', async () => {
    const html = await loadChapter('migration');
    expect(html).toContain('作業員別 当月集計');
    expect(html).toContain('累計人工');
    expect(html).toContain('累計労務費');
    expect(html).toContain('基準日');
  });

  it('完了現場と削除の章が閲覧のみ・再認証・復元・削除ログに触れている', async () => {
    const html = await loadChapter('sites');
    expect(html).toContain('閲覧のみ');
    expect(html).toContain('進行中に戻す');
    expect(html).toContain('パスワード');
    expect(html).toContain('復元');
    expect(html).toContain('削除ログ');
  });

  it('準備の章が確認者・承認者、日当の適用開始日、協力会社アカウントに触れている', async () => {
    const html = await loadChapter('setup');
    expect(html).toContain('承認は割り当てた人');
    expect(html).toContain('適用開始日');
    expect(html).toContain('協力会社アカウントを追加');
    expect(html).toContain('担当');
  });

  it('未掲載の slug は GuideNotFound', async () => {
    await expect(loadChapter('nothing')).rejects.toBeInstanceOf(GuideNotFound);
    await expect(loadChapter('../../package')).rejects.toBeInstanceOf(GuideNotFound);
  });
});
