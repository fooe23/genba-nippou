import { describe, expect, it } from 'vitest';
import {
  addablePartnerSuppliers,
  affiliationLabel,
  canDeleteWorker,
  countInactive,
  filterWorkers,
  laborRowAffiliation,
  partnerWorkerChoices,
  storedLaborAffiliations,
  workerFilterOptions,
} from '@/lib/calc/affiliation';
import type { Affiliation } from '@/lib/types';

const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const names = { [S1]: '山田工務店', [S2]: '青木設備' };

const w = (id: string, name: string, affiliation: Affiliation, supplierId: string | null, active = true) => ({ id, name, affiliation, supplierId, active });
const workers = [
  w('o1', '田中', 'own', null),
  w('o2', '佐藤', 'own', null, false),
  w('p1', '鈴木', 'partner', S1),
  w('p2', '高橋', 'partner', S1, false),
  w('p3', '伊藤', 'partner', S2),
];

describe('affiliationLabel（所属の表示名）', () => {
  it('自社／取引先名／所属なし', () => {
    expect(affiliationLabel('own', null, names)).toBe('自社');
    expect(affiliationLabel('partner', S1, names)).toBe('山田工務店');
    expect(affiliationLabel(null, null, names)).toBe('所属なし');
    expect(affiliationLabel(undefined, undefined, names)).toBe('所属なし');
  });
  it('協力会社で名前が引けなければ「協力会社」', () => {
    expect(affiliationLabel('partner', 'unknown', names)).toBe('協力会社');
    expect(affiliationLabel('partner', null, names)).toBe('協力会社');
  });
});

describe('filterWorkers・countInactive（作業員マスターの一覧）', () => {
  it('既定は有効な作業員だけ', () => {
    expect(filterWorkers(workers, 'all', false).map((x) => x.id)).toEqual(['o1', 'p1', 'p3']);
    expect(filterWorkers(workers, 'all', true).map((x) => x.id)).toEqual(['o1', 'o2', 'p1', 'p2', 'p3']);
  });
  it('自社・会社ごとに絞り込む', () => {
    expect(filterWorkers(workers, 'own', true).map((x) => x.id)).toEqual(['o1', 'o2']);
    expect(filterWorkers(workers, S1, false).map((x) => x.id)).toEqual(['p1']);
    expect(filterWorkers(workers, S2, true).map((x) => x.id)).toEqual(['p3']);
  });
  it('無効の人数は絞り込みに合わせて数える', () => {
    expect(countInactive(workers, 'all')).toBe(2);
    expect(countInactive(workers, 'own')).toBe(1);
    expect(countInactive(workers, S2)).toBe(0);
  });
  it('絞り込みの選択肢：すべて・自社・作業員がいる会社（名前順。localeCompare ja）', () => {
    expect(workerFilterOptions(workers, names)).toEqual([
      { value: 'all', label: 'すべて' },
      { value: 'own', label: '自社' },
      { value: S1, label: '山田工務店' },
      { value: S2, label: '青木設備' },
    ]);
  });
});

describe('canDeleteWorker（削除ボタン）', () => {
  it('日報・繰越で使っていない作業員だけ削除できる', () => {
    const used = new Set(['o1', 'p1']);
    expect(canDeleteWorker('o1', used)).toBe(false);
    expect(canDeleteWorker('o2', used)).toBe(true);
  });
});

describe('laborRowAffiliation（日報の作業員の行の所属）', () => {
  const master = { affiliation: 'partner' as const, supplierId: S1 };
  it('手入力の行は所属なし', () => {
    expect(laborRowAffiliation({ workerId: null }, new Map(), undefined)).toEqual({ affiliation: null, supplierId: null });
  });
  it('行の保存済みの写しを優先する', () => {
    expect(laborRowAffiliation({ workerId: 'p1', affiliation: 'own', supplierId: null }, new Map(), master)).toEqual({ affiliation: 'own', supplierId: null });
  });
  it('同じ作業員のほかの行の写し → マスターの順', () => {
    const stored = storedLaborAffiliations([
      { workerId: 'p1', affiliation: 'partner', supplierId: S2 },
      { workerId: 'p1', affiliation: 'own', supplierId: null },
      { workerId: null, affiliation: null },
    ]);
    expect(stored.get('p1')).toEqual({ affiliation: 'partner', supplierId: S2 });
    expect(laborRowAffiliation({ workerId: 'p1', affiliation: null }, stored, master)).toEqual({ affiliation: 'partner', supplierId: S2 });
    expect(laborRowAffiliation({ workerId: 'p3' }, stored, { affiliation: 'partner', supplierId: S2 })).toEqual({ affiliation: 'partner', supplierId: S2 });
    expect(laborRowAffiliation({ workerId: 'o1' }, stored, { affiliation: 'own', supplierId: null })).toEqual({ affiliation: 'own', supplierId: null });
  });
  it('マスターにも無い作業員は所属なし', () => {
    expect(laborRowAffiliation({ workerId: 'x' }, new Map(), undefined)).toEqual({ affiliation: null, supplierId: null });
  });
});

describe('現場の協力会社と作業員の選択肢', () => {
  it('追加できる会社：有効で、まだ現場に無い取引先（名前順）', () => {
    const suppliers = [
      { id: S1, name: '山田工務店', active: true },
      { id: S2, name: '青木設備', active: true },
      { id: 's3', name: '無効商店', active: false },
      { id: 's4', name: 'あおい建材', active: true },
    ];
    expect(addablePartnerSuppliers(suppliers, [S1]).map((s) => s.id)).toEqual(['s4', S2]);
  });
  it('登録できる作業員：その会社の有効な協力会社の作業員だけ', () => {
    expect(partnerWorkerChoices(workers, S1).map((x) => x.id)).toEqual(['p1']);
    expect(partnerWorkerChoices(workers, S2).map((x) => x.id)).toEqual(['p3']);
  });
});
