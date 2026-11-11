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
      'changes',
      'estimate',
      'budget',
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

  it('追加・変更の精算の章が、3 つの精算方法・種別の数え方・精算資料の読み方に触れている', async () => {
    expect(GUIDE_CHAPTERS.find((c) => c.slug === 'changes')?.title).toBe('追加・変更の精算');
    const html = await loadChapter('changes');
    expect(html).toContain('追加・変更の一覧');
    expect(html).toContain('一式');
    expect(html).toContain('常用単価');
    expect(html).toContain('客先都合');
    expect(html).toContain('やり直し');
    expect(html).toContain('精算額（累計）');
    expect(html).toContain('実績原価は出ません');
    expect(html).toContain('プレビュー');
  });

  it('実行予算・予算と実績の章が、工種・経費と減分・Excel の取り込み直し・判定・% の上書きに触れている', async () => {
    expect(GUIDE_CHAPTERS.find((c) => c.slug === 'budget')?.title).toBe('実行予算・予算と実績');
    const html = await loadChapter('budget');
    expect(html).toContain('工種（識別）');
    expect(html).toContain('経費');
    expect(html).toContain('減分');
    expect(html).toContain('使用中のため残します');
    expect(html).toContain('変更の行として足す');
    expect(html).toContain('空の雛形');
    expect(html).toContain('予算の標準日当');
    expect(html).toContain('赤字の見込み');
    expect(html).toContain('上書きを外す');
    expect(html).toContain('繰越（工種なし）');
    expect(html).not.toContain('次の段階');
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

  it('提出と承認の章に客先確認の記録（承認後・完了現場でも記録できる・PDF の欄・取り消し）がある', async () => {
    const html = await loadChapter('approval');
    expect(html).toContain('客先確認の記録');
    expect(html).toContain('客先確認を記録');
    expect(html).toContain('承認済みの日報や完了した現場の日報にも記録できます');
    expect(html).toContain('確認者名／日付／サイン');
    expect(html).toContain('取り消す');
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

  it('準備の章が Excel のマスターの取り込みと、その決まりに触れている', async () => {
    const html = await loadChapter('setup');
    expect(html).toContain('Excel のマスターをまとめて取り込む');
    expect(html).toContain('名前で突き合わせます');
    expect(html).toContain('空の欄は「変更しない」');
    expect(html).toContain('Excel に無い行は消しません');
    expect(html).toContain('車両名／ナンバー');
  });

  it('入力の章がマスターに無い人・取引先・車両・リース品の手入力に触れている', async () => {
    const html = await loadChapter('input');
    expect(html).toContain('マスターに無い人・取引先・車両・リース品を入れるとき');
    expect(html).toContain('品目名の欄が出て、単価の欄');
    expect(html).toContain('燃費（km/L）の欄');
    expect(html).toContain('（手入力）');
    expect(html).toContain('現場管理台帳（Excel）');
  });

  it('Excel 出力の章が、新しい現場管理台帳（2 シート・式の合計・例）に触れ、原本の xlsm の書き出しは書かない', async () => {
    const html = await loadChapter('excel');
    expect(html).toContain('現場原価集計');
    expect(html).toContain('出面一覧');
    expect(html).toContain('SUM');
    expect(html).toContain('¥215,000');
    expect(html).toContain('現場名_現場管理台帳_2026年11月.xlsx');
    expect(html).not.toContain('原本 Excel（.xlsm）をダウンロード');
  });

  it('入力の章が区分の「増」と「追加」の違いに触れている', async () => {
    const html = await loadChapter('input');
    expect(html).toContain('追加・増・変更・減の記録');
    expect(html).toContain('同じ流れの中で数量が増えた');
    expect(html).toContain('新しく別の仕事が増えた');
    expect(html).toContain('増（数量増）');
  });

  it('入力の章が 1 日分の雛形の取り込みと、上書きの確認に触れている', async () => {
    const html = await loadChapter('input');
    expect(html).toContain('Excel（1 日分の雛形）から取り込む');
    expect(html).toContain('「1回目」シート');
    expect(html).toContain('上書きする');
    expect(html).toContain('承認済みの日報と完了した現場には取り込めません');
  });

  it('写真・資料の添付の章が、付け方・自動で軽く・10MB・G ドライブ・お客様用・協力会社・時期に触れている', async () => {
    expect(GUIDE_CHAPTERS.find((c) => c.slug === 'photos')?.title).toBe('写真・資料の添付');
    const html = await loadChapter('photos');
    expect(html).toContain('ドラッグ＆ドロップ');
    expect(html).toContain('自動で軽く');
    expect(html).toContain('1 つ 10MB まで');
    expect(html).toContain('共有の設定');
    expect(html).toContain('お客様用 PDF に載せる');
    expect(html).toContain('ファイル（見積書など）は見られません・付けられません');
    expect(html).toContain('提出までに付ける');
    expect(html).toContain('完了するまでいつでも');
    expect(html).toContain('修正を申請');
  });

  it('未掲載の slug は GuideNotFound', async () => {
    await expect(loadChapter('nothing')).rejects.toBeInstanceOf(GuideNotFound);
    await expect(loadChapter('../../package')).rejects.toBeInstanceOf(GuideNotFound);
  });
});
