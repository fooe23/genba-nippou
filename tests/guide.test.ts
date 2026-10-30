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
      'input',
      'approval',
      'summary',
      'carryover',
      'migration',
      'excel',
      'pdf',
      'estimate',
      'photos',
    ]);
    expect(GUIDE_CHAPTERS[0].title).toBe('ガイドの使い方');
    expect(GUIDE_CHAPTERS[4].title).toBe('前月繰越の考え方');
    expect(GUIDE_CHAPTERS[5].title).toBe('移行時の繰越初期値の登録');
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

  it('未掲載の slug は GuideNotFound', async () => {
    await expect(loadChapter('nothing')).rejects.toBeInstanceOf(GuideNotFound);
    await expect(loadChapter('../../package')).rejects.toBeInstanceOf(GuideNotFound);
  });
});
