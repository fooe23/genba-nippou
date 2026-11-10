import { describe, expect, it } from 'vitest';
import { outputBreakdown } from '@/lib/report/contract-work';
import {
  EMPTY_SUBCONTRACT_OUTPUT,
  budgetSubcontractAmounts,
  changesWithSubcontract,
  issueKindMap,
  subcontractOutput,
  subcontractOutputCategory,
  subcontractOutputLines,
  subcontractOutputsByReport,
} from '@/lib/report/subcontract-output';
import type { IssueKind } from '@/lib/types';

const kinds = new Map<string, IssueKind>([
  ['i-extra', 'extra'],
  ['i-inc', 'increase'],
  ['i-change', 'change'],
  ['i-minus', 'minus'],
  ['i-site', 'site_judgment'],
  ['i-rework', 'rework'],
]);

describe('subcontractOutputCategory（外注の支払いを出来高のどこに数えるか）', () => {
  it('件を選んでいない外注は契約内', () => {
    expect(subcontractOutputCategory(null, kinds)).toBe('contract');
  });
  it('件を選んだ外注はその件の区分（追加・増・変更。現場判断などは追加）', () => {
    expect(subcontractOutputCategory('i-extra', kinds)).toBe('extra');
    expect(subcontractOutputCategory('i-inc', kinds)).toBe('increase');
    expect(subcontractOutputCategory('i-change', kinds)).toBe('change');
    expect(subcontractOutputCategory('i-site', kinds)).toBe('extra');
  });
  it('減・やり直しの件、読めない件の外注は数えない（精算と同じ）', () => {
    expect(subcontractOutputCategory('i-minus', kinds)).toBeNull();
    expect(subcontractOutputCategory('i-rework', kinds)).toBeNull();
    expect(subcontractOutputCategory('unknown', kinds)).toBeNull();
  });
});

describe('subcontractOutput（外注の支払いの出来高）', () => {
  it('行が無ければ 0', () => {
    expect(subcontractOutput([], kinds)).toEqual(EMPTY_SUBCONTRACT_OUTPUT);
  });
  it('契約内・区分ごとに足し、合計は数えた分だけ', () => {
    const out = subcontractOutput(
      [
        { amount: 170_000, issueId: null },
        { amount: 30_000, issueId: 'i-inc' },
        { amount: 10_000, issueId: 'i-extra' },
        { amount: 5_000, issueId: 'i-site' },
        { amount: 8_000, issueId: 'i-change' },
        { amount: 99_000, issueId: 'i-minus' },
      ],
      kinds,
    );
    expect(out).toEqual({ contract: 170_000, extra: 15_000, increase: 30_000, change: 8_000, total: 223_000 });
  });
  it('件の種別は Record でも渡せる', () => {
    expect(subcontractOutput([{ amount: 1_000, issueId: 'a' }], { a: 'change' }).change).toBe(1_000);
  });
});

describe('subcontractOutputLines（日報の明細から外注の行を取り出す）', () => {
  it('外注の買掛だけ（仕入・ほかの区分は入れない）', () => {
    const lines = [
      { kind: 'credit', purchaseKind: 'subcontract', issueId: null, amount: 170_000 },
      { kind: 'credit', purchaseKind: 'material', issueId: null, amount: 5_000 },
      { kind: 'cash', issueId: null, amount: 3_000 },
      { kind: 'credit', purchaseKind: 'subcontract', issueId: 'i-inc', amount: 2_000 },
    ] as const;
    expect(subcontractOutputLines(lines, (l) => l.amount)).toEqual([
      { amount: 170_000, issueId: null },
      { amount: 2_000, issueId: 'i-inc' },
    ]);
  });
});

describe('subcontractOutputsByReport（日報ごとの外注の出来高）', () => {
  it('日報 id ごとにまとめる', () => {
    const m = subcontractOutputsByReport(
      [
        { reportId: 'r1', amount: 170_000, issueId: null },
        { reportId: 'r1', amount: 25_000, issueId: 'i-inc' },
        { reportId: 'r2', amount: 40_000, issueId: 'i-minus' },
      ],
      kinds,
    );
    expect(m.get('r1')).toEqual({ contract: 170_000, extra: 0, increase: 25_000, change: 0, total: 195_000 });
    expect(m.get('r2')).toEqual(EMPTY_SUBCONTRACT_OUTPUT);
    expect(m.has('r3')).toBe(false);
  });
});

describe('issueKindMap', () => {
  it('件の id → 種別', () => {
    expect(issueKindMap([{ id: 'a', kind: 'extra' }, { id: 'b', kind: 'minus' }])).toEqual(
      new Map([
        ['a', 'extra'],
        ['b', 'minus'],
      ]),
    );
  });
});

describe('changesWithSubcontract（区分ごとの金額に件を選んだ外注を足す）', () => {
  it('作業内容の契約外が無くても、件を選んだ外注があれば区分ごとの金額を作る', () => {
    expect(changesWithSubcontract(null, { contract: 0, extra: 0, increase: 25_000, change: 0, total: 25_000 })).toEqual({
      extra: 0,
      increase: 25_000,
      change: 0,
      minus: 0,
      net: 25_000,
    });
  });
  it('両方無ければ null のまま', () => {
    expect(changesWithSubcontract(null, { ...EMPTY_SUBCONTRACT_OUTPUT, contract: 170_000, total: 170_000 })).toBeNull();
  });
  it('作業内容の区分ごとの金額に足す（減はそのまま）', () => {
    const work = { extra: 10_000, increase: 25_000, change: 0, minus: -5_000, net: 30_000 };
    expect(changesWithSubcontract(work, { contract: 0, extra: 1_000, increase: 2_000, change: 3_000, total: 6_000 })).toEqual({
      extra: 11_000,
      increase: 27_000,
      change: 3_000,
      minus: -5_000,
      net: 36_000,
    });
  });
});

describe('outputBreakdown に外注を入れる（村山様邸 11/10 の例）', () => {
  // 作業内容：養生（契約内）¥20,000、増 ¥25,000（件あり）。外注：東北建興 タイル ¥170,000（件なし）
  const work = { extra: 0, increase: 25_000, change: 0, minus: 0, net: 25_000 };
  const sub = subcontractOutput([{ amount: 170_000, issueId: null }], kinds);
  it('契約内 = 契約内の作業内容 + 件を選んでいない外注、増はそのまま、合計に外注が入る', () => {
    expect(outputBreakdown(45_000, work, sub)).toEqual({
      contract: 190_000,
      changes: 25_000,
      total: 215_000,
      subcontractContract: 170_000,
      subcontractChanges: 0,
    });
  });
  it('件を選んだ外注は追加・変更（精算が必要）に入る', () => {
    const tagged = subcontractOutput([{ amount: 170_000, issueId: 'i-inc' }], kinds);
    expect(outputBreakdown(45_000, work, tagged)).toEqual({
      contract: 20_000,
      changes: 195_000,
      total: 215_000,
      subcontractContract: 0,
      subcontractChanges: 170_000,
    });
  });
  it('外注を渡さなければ従来どおり', () => {
    expect(outputBreakdown(45_000, work)).toEqual({ contract: 20_000, changes: 25_000, total: 45_000, subcontractContract: 0, subcontractChanges: 0 });
  });
});

describe('budgetSubcontractAmounts（実行予算の請負の行を会社ごとに足す）', () => {
  it('工種をまたいで会社ごとに足し、ほかの項目・会社の無い行は数えない', () => {
    expect(
      budgetSubcontractAmounts([
        { item: 'subcontract', supplierId: 'pT', amount: 300_000 },
        { item: 'subcontract', supplierId: 'pT', amount: 100_000 },
        { item: 'jouyou', supplierId: 'pT', amount: 50_000 },
        { item: 'subcontract', supplierId: null, amount: 9_000 },
        { item: 'subcontract', supplierId: 'pA', amount: 80_000 },
      ]),
    ).toEqual({ pT: 400_000, pA: 80_000 });
  });
});
