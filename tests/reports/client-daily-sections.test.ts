import { describe, it, expect } from 'vitest';
import type { Attachment } from '@/lib/db/attachments-schemas';
import { formatCell, type SectionTable } from '@/lib/reports/cost-sections';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import {
  CLIENT_DAILY_TITLE,
  clientDailyConfirmation,
  clientDailyFooterText,
  clientDailyHeaderRows,
  clientDailyPhotos,
  clientDailyIssueList,
  clientEstimateCell,
  clientDailyTables,
  clientIssueTable,
  clientPhotosNote,
  CLIENT_DAILY_ISSUES_TITLE,
  NO_ISSUES_TODAY,
  PHOTO_LOAD_FAILED,
  type ClientIssueRow,
  type ClientListIssue,
  type ClientPhotoIssue,
} from '@/lib/reports/client-daily-sections';
import type { SavedReportLine } from '@/lib/reports/types';
import { changeWorkLines, lines, report, sampleDaily, site, withChanges } from './daily-fixture';

const text = (t: SectionTable) => t.rows.map((r) => r.map(formatCell));
const heads = (t: SectionTable) => t.columns.map((c) => c.label);

describe('お客様用日報の見出し', () => {
  it('現場名・日付（曜日）・天候・作業責任者・作業時間（共通時間の開始〜終了）', () => {
    expect(clientDailyHeaderRows(sampleDaily())).toEqual([
      ['現場名', '〇〇邸新築工事'],
      ['日付', '2026/11/02（月）'],
      ['天候', '晴れ'],
      ['作業責任者', '大江'],
      ['作業時間', '08:00〜17:30'],
    ]);
  });

  it('共通時間が無ければ作業時間は空（—）', () => {
    const m = sampleDaily({ report: report('2026-11-02', { common: { start: null, end: null, breakMin: 30, gapMin: null } }) });
    expect(clientDailyHeaderRows(m)[4]).toEqual(['作業時間', null]);
  });

  it('題名と脚注', () => {
    expect(CLIENT_DAILY_TITLE).toBe('現場日報（お客様用）');
    expect(clientDailyFooterText('2026-11-03T01:00:00Z')).toBe('現場日報アプリ ― 現場日報（お客様用） 出力日時 2026/11/03 10:00');
  });
});

describe('お客様用日報の表', () => {
  it('本日の作業：区分／工種／施工内容／数量／単位／人工。減の数量は負、施工内容に【区分】を付けない', () => {
    const { work } = clientDailyTables(withChanges());
    expect(heads(work)).toEqual(['区分', '工種', '施工内容', '数量', '単位', '人工']);
    expect(text(work)).toEqual([
      ['契約内', '大工', '床下地, "1 階"', '20', 'm2', '2.0'],
      ['契約内', '', '片付け', '—', '', '0.5'],
      ['追加', '大工', '棚の追加', '2', '台', '1.0'],
      ['増', '大工', '棚板の増', '1', '枚', '0.5'],
      ['変更', '建具', '窓の変更', '1', '式', '0.5'],
      ['減', '電気', '照明の減', '-3', '台', '0.0'],
    ]);
    expect(work.boldRows).toEqual([2, 3, 4, 5]);
  });

  it('作業員 N 名・合計 M.M 人工（作業員が居なければ null）', () => {
    expect(clientDailyTables(sampleDaily()).workersLine).toBe('作業員 3 名・合計 2.0 人工');
    const noWorkers = sampleDaily({ report: report('2026-11-02', { lines: lines.filter((l) => l.kind !== 'labor') }) });
    expect(clientDailyTables(noWorkers).workersLine).toBeNull();
  });

  it('金額・作業員の氏名と時間・日当・労務費・車両・リース・購入・連絡事項・重要事項の本文は出さない', () => {
    const m = withChanges();
    const t = clientDailyTables(m);
    const all = [
      ...clientDailyHeaderRows(m).flat(),
      t.workersLine ?? '',
      ...[t.work].flatMap((x) => [...heads(x), ...text(x).flat(), ...(x.total ?? []).map(formatCell)]),
    ].join('\n');
    for (const bad of [
      '日当', '労務費', '円', '¥', '金額', '原価', '出来高', '進捗',
      '田中', '鈴木', '佐藤', '07:00', '19:00',
      '2t ダンプ', '足場', '発電機', '釘', '合板', '山田商店',
      '100,000', '60,001', '15,003',
      m.notes, m.issues.text,
    ]) {
      expect(all).not.toContain(bad);
    }
  });
});

describe('お客様確認', () => {
  it('記録済み：確認者名・確認日時とメモ。サインは小さな枠ではなく大きなサイン欄', () => {
    expect(clientDailyConfirmation(withChanges())).toEqual({
      boxes: [['確認者名', '施主 〇〇様'], ['確認日時', '2026/11/02 17:15']],
      note: '棚の追加と窓の変更を現地で確認。照明は 3 台減で了承。',
      signLabel: 'サイン',
    });
  });

  it('未記録：確認者名／日付 の空欄とサイン欄（空欄 3 つ）、メモなし', () => {
    expect(clientDailyConfirmation(sampleDaily())).toEqual({
      boxes: [['確認者名', ''], ['日付', '']],
      note: null,
      signLabel: 'サイン',
    });
  });

  it('日報の無い日のモデルでも表は空', () => {
    const t = clientDailyTables(buildEmptyDailyReport(site, '2026-11-04'));
    expect(t.work.rows).toEqual([]);
    expect(t.workersLine).toBeNull();
  });
});

describe('お客様用日報に所属を出さない', () => {
  it('協力会社（請負）・自社の作業員がいても、見出し・表・作業員の行・確認欄に 所属／自社／協力会社／所属なし が無い', () => {
    const affiliated = lines.map((l, i) =>
      l.kind === 'labor'
        ? ({ ...l, affiliation: i === 0 ? 'own' : 'partner', supplierId: i === 0 ? null : 'pZ', laborContract: i === 0 ? null : 'ukeoi' } as SavedReportLine)
        : l,
    );
    const m = sampleDaily({ report: report('2026-11-02', { lines: [...affiliated, ...changeWorkLines] }) });
    const { work, workersLine } = clientDailyTables(m);
    const issueTable = clientIssueTable(
      clientDailyIssueList([listIssue({ id: 'x1', body: '棚を 2 台追加' })], new Map(), ['x1']),
      { showEstimate: true },
    );
    const conf = clientDailyConfirmation(m);
    const photos = clientDailyPhotos(m, [photo({ id: 'p1', issueId: 'x1', caption: '' }), photo({ id: 'p2', caption: '下地' })], [
      photoIssue({ id: 'x1', body: '棚を 2 台追加' }),
    ]);
    expect(photos).toHaveLength(2);
    const words = [
      ...photos.map((p) => p.caption),
      ...clientDailyHeaderRows(m).flat(),
      ...heads(work), ...text(work).flat(),
      ...heads(issueTable), ...text(issueTable).flat(),
      workersLine,
      ...conf.boxes.flat(),
      conf.note,
    ].filter((v): v is string => typeof v === 'string');
    expect(workersLine).not.toBeNull();
    for (const word of ['所属', '自社', '協力会社', '所属なし', '円', '金額']) expect(words.filter((w) => w.includes(word))).toEqual([]);
  });
});

// ─── 写真 ───

const DAY = '2026-11-02';

function photo(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    siteId: 's1',
    kind: 'photo',
    name: `${over.id}.jpg`,
    caption: '',
    storageBucket: 'gn-photos',
    storagePath: `s1/att/${over.id}.jpg`,
    mime: 'image/jpeg',
    sizeBytes: 300_000,
    clientVisible: true,
    attachedOn: DAY,
    createdBy: 'p1',
    createdByName: '大江',
    createdAt: '2026-11-02T03:00:00Z',
    ...(over.issueId ? {} : { reportId: `r-${DAY}` }),
    ...over,
  };
}

function photoIssue(over: Partial<ClientPhotoIssue> & { id: string }): ClientPhotoIssue {
  return { reportDate: DAY, number: 1, kind: 'extra', body: '件の本文', ...over };
}

describe('お客様用日報の写真（clientDailyPhotos）', () => {
  const photoIssues: ClientPhotoIssue[] = [
    photoIssue({ id: 'today2', number: 2, body: '2 階トイレの手すりを追加する（位置は現地で確認済み）' }),
    photoIssue({ id: 'today1', number: 1, body: '棚の追加' }),
    photoIssue({ id: 'old', reportDate: '2026-10-30', number: 3, kind: 'change', body: '外壁の色を変更' }),
    photoIssue({ id: 'redo', number: 4, kind: 'rework', body: '自社の手直し' }),
  ];

  it('件の写真（件を書いた日 → 番号の順）→ 日報の写真。文は「MM/DD-番号 ひと言」、ひと言が空なら本文の先頭 20 字', () => {
    const list = [
      photo({ id: 'rep1', caption: '朝の様子' }),
      photo({ id: 'a2', issueId: 'today2', caption: '' }),
      photo({ id: 'rep2', caption: '' }),
      photo({ id: 'a1', issueId: 'today1', caption: '棚の位置' }),
      photo({ id: 'a1b', issueId: 'today1', caption: '  下地  ' }),
      photo({ id: 'o1', issueId: 'old', caption: '色見本' }),
    ];
    expect(clientDailyPhotos(sampleDaily(), list, photoIssues)).toEqual([
      { attachmentId: 'o1', caption: '10/30-3 色見本' },
      { attachmentId: 'a1', caption: '11/02-1 棚の位置' },
      { attachmentId: 'a1b', caption: '11/02-1 下地' },
      { attachmentId: 'a2', caption: '11/02-2 2 階トイレの手すりを追加する（位置は現…' },
      { attachmentId: 'rep1', caption: '朝の様子' },
      { attachmentId: 'rep2', caption: '' },
    ]);
  });

  it('チェックなしの写真・ファイル・リンク・やり直しの件の写真・別の日に付けた写真・知らない件の写真は出さない', () => {
    const list = [
      photo({ id: 'ok', issueId: 'today1' }),
      photo({ id: 'unchecked', clientVisible: false }),
      photo({ id: 'unchecked-issue', issueId: 'today1', clientVisible: false }),
      photo({ id: 'file', kind: 'file', mime: 'application/pdf', storageBucket: 'gn-estimates', issueId: 'today1' }),
      { ...photo({ id: 'link', kind: 'link', url: 'https://drive.google.com/x' }), storageBucket: undefined, storagePath: undefined },
      photo({ id: 'redo-photo', issueId: 'redo' }),
      photo({ id: 'other-day', issueId: 'today1', attachedOn: '2026-11-01' }),
      photo({ id: 'other-day-report', attachedOn: '2026-11-03' }),
      photo({ id: 'unknown-issue', issueId: 'zzz' }),
    ];
    expect(clientDailyPhotos(sampleDaily(), list, photoIssues).map((p) => p.attachmentId)).toEqual(['ok']);
  });

  it('写真が無い日・日報の無い日は空（PDF は写真の節を出さない）', () => {
    expect(clientDailyPhotos(sampleDaily(), [], photoIssues)).toEqual([]);
    expect(clientDailyPhotos(buildEmptyDailyReport(site, DAY), [photo({ id: 'x' })], [])).toEqual([]);
  });

  it('写真の節の枚数と、読めなかった写真の文', () => {
    expect(clientPhotosNote(3)).toBe('3 枚');
    expect(PHOTO_LOAD_FAILED).toBe('写真を読み込めませんでした');
  });
});

// ─── 確認していただく件（clientDailyIssueList・clientIssueTable） ───

function listIssue(over: Partial<ClientListIssue> & { id: string }): ClientListIssue {
  return { reportDate: DAY, number: 1, kind: 'extra', body: '件の本文', status: 'open', ...over };
}

const att = (kind: Attachment['kind'], clientVisible = kind === 'photo') => ({ kind, clientVisible });

describe('確認していただく件', () => {
  const list: ClientListIssue[] = [
    listIssue({ id: 'c', reportDate: DAY, number: 2, kind: 'minus', body: '照明を 3 台減', status: 'done' }),
    listIssue({ id: 'a', reportDate: '2026-10-30', number: 3, kind: 'extra', body: '棚を 2 台追加', status: 'estimating' }),
    listIssue({ id: 'r', reportDate: DAY, number: 3, kind: 'rework', body: '自社の手直し' }),
    listIssue({ id: 'b', reportDate: DAY, number: 1, kind: 'site_judgment', body: '下地の補修', status: 'open' }),
    listIssue({ id: 'n', reportDate: DAY, number: 4, kind: 'change', body: '選ばれていない件' }),
  ];
  const byIssue = new Map([
    ['a', [att('file'), att('photo'), att('photo'), att('photo', false), att('link')]],
    ['b', [att('photo', false)]],
    ['c', [att('photo')]],
    ['r', [att('photo')]],
  ]);

  it('選んだ件だけ、件の日付 → 番号の順。種別・状態はお客様向けの表示名、見積書あり・写真はチェックした写真の数', () => {
    const rows = clientDailyIssueList(list, byIssue, ['c', 'a', 'b', 'r', 'a']);
    expect(rows).toEqual<ClientIssueRow[]>([
      { number: '10/30-3', kindLabel: '追加指示', body: '棚を 2 台追加', statusLabel: 'お見積り中', hasEstimate: true, estimateSubmitted: false, photoCount: 2 },
      { number: '11/02-1', kindLabel: '現場の状況による追加（ご相談）', body: '下地の補修', statusLabel: '対応中', hasEstimate: false, estimateSubmitted: false, photoCount: 0 },
      { number: '11/02-2', kindLabel: '減', body: '照明を 3 台減', statusLabel: '完了', hasEstimate: false, estimateSubmitted: false, photoCount: 1 },
    ]);
  });

  it('やり直しの件は選ばれていても入らない。何も選ばなければ空', () => {
    expect(clientDailyIssueList(list, byIssue, ['r'])).toEqual([]);
    expect(clientDailyIssueList(list, byIssue, [])).toEqual([]);
  });

  it('表：件／種別／内容／状態／見積書／写真。協力会社が作るときは見積書の列を出さない', () => {
    const rows = clientDailyIssueList(list, byIssue, ['a', 'b']);
    const staff = clientIssueTable(rows, { showEstimate: true });
    expect(CLIENT_DAILY_ISSUES_TITLE).toBe('確認していただく件');
    expect(heads(staff)).toEqual(['件', '種別', '内容', '状態', '見積書', '写真']);
    expect(text(staff)).toEqual([
      ['10/30-3', '追加指示', '棚を 2 台追加', 'お見積り中', 'あり', '2 枚'],
      ['11/02-1', '現場の状況による追加（ご相談）', '下地の補修', '対応中', 'なし', 'なし'],
    ]);
    const partner = clientIssueTable(rows, { showEstimate: false });
    expect(heads(partner)).toEqual(['件', '種別', '内容', '状態', '写真']);
    expect(text(partner).flat().join('\n')).not.toMatch(/見積書|あり/);
    expect(staff.columns.reduce((a, c) => a + c.w, 0)).toBeCloseTo(partner.columns.reduce((a, c) => a + c.w, 0));
  });

  it('見積提出の記録（2026-11-14）：ファイルが無く記録がある件は「提出済み」。ファイルがあれば「あり」が優先。協力会社は列ごと出さない', () => {
    const withSubmitted: ClientListIssue[] = [
      listIssue({ id: 'a', number: 1, estimateSubmittedOn: '2026-11-01' }),
      listIssue({ id: 'b', number: 2, estimateSubmittedOn: '2026-11-01' }),
      listIssue({ id: 'c', number: 3, estimateSubmittedOn: null }),
    ];
    const rows = clientDailyIssueList(withSubmitted, new Map([['a', [att('file')]]]), ['a', 'b', 'c']);
    expect(rows.map((r) => [r.hasEstimate, r.estimateSubmitted])).toEqual([
      [true, true],
      [false, true],
      [false, false],
    ]);
    expect(rows.map(clientEstimateCell)).toEqual(['あり', '提出済み', 'なし']);
    expect(text(clientIssueTable(rows, { showEstimate: true })).map((r) => r[4])).toEqual(['あり', '提出済み', 'なし']);
    expect(text(clientIssueTable(rows, { showEstimate: false })).flat().join('\n')).not.toMatch(/提出|見積/);
  });

  it('件が無ければ行が無い（PDF は「ありません」の 1 行）', () => {
    expect(NO_ISSUES_TODAY).toBe('ありません');
    expect(clientIssueTable([], { showEstimate: true }).rows).toEqual([]);
  });

  it('社内の言葉（所属・自社・協力会社・金額・提案額・日当）が出ない', () => {
    const rows = clientDailyIssueList(list, byIssue, list.map((i) => i.id));
    const t = clientIssueTable(rows, { showEstimate: true });
    const words = [...heads(t), ...text(t).flat()].join('\n');
    for (const bad of ['所属', '自社', '協力会社', '金額', '提案額', '日当', '円', '見積中', 'やり直し', '手直し']) {
      expect(words).not.toContain(bad);
    }
  });
});
