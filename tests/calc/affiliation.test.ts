import { describe, expect, it } from 'vitest';
import {
  addablePartnerSuppliers,
  affiliationLabel,
  countInactive,
  filterWorkers,
  laborContractValue,
  laborRowAffiliation,
  partnerWorkerChoices,
  storedLaborAffiliations,
  workerDeleteView,
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

describe('workerDeleteView（削除の欄）', () => {
  it('使っていなければ削除、使っていれば案内、確認中・失敗は何も出さない', () => {
    expect(workerDeleteView({ used: false })).toBe('deletable');
    expect(workerDeleteView({ used: true })).toBe('in_use');
    expect(workerDeleteView('loading')).toBe('none');
    expect(workerDeleteView('error')).toBe('none');
  });
});

describe('laborRowAffiliation・laborContractValue（日報の作業員の行。サーバーの保存と同じ値）', () => {
  const master = { affiliation: 'partner' as const, supplierId: S1 };
  const stored = storedLaborAffiliations([
    { kind: 'labor', workerId: 'p1', affiliation: 'partner', supplierId: S2, laborContract: 'ukeoi' },
    { kind: 'labor', workerId: 'p1', affiliation: 'own', supplierId: null, laborContract: null },
    { kind: 'labor', workerId: 'o1', affiliation: 'own', supplierId: null, laborContract: null },
    { kind: 'labor', workerId: null, affiliation: null },
    { kind: 'fuel', workerId: 'x' },
  ]);
  it('保存済みの写しは作業員ごとに最初の行', () => {
    expect(stored.get('p1')).toEqual({ affiliation: 'partner', supplierId: S2, laborContract: 'ukeoi' });
    expect(stored.get('o1')).toEqual({ affiliation: 'own', supplierId: null, laborContract: null });
    expect(stored.has('x')).toBe(false);
  });
  it('手入力の行は所属なし', () => {
    expect(laborRowAffiliation({ workerId: null }, stored, undefined)).toEqual({ affiliation: null, supplierId: null });
  });
  it('保存済みの作業員は保存済みの所属（マスターが変わっても）', () => {
    expect(laborRowAffiliation({ workerId: 'p1' }, stored, master)).toEqual({ affiliation: 'partner', supplierId: S2 });
  });
  it('新しく加えた作業員はマスター。マスターにも無ければ所属なし', () => {
    expect(laborRowAffiliation({ workerId: 'p3' }, stored, { affiliation: 'partner', supplierId: S2 })).toEqual({ affiliation: 'partner', supplierId: S2 });
    expect(laborRowAffiliation({ workerId: 'x' }, stored, undefined)).toEqual({ affiliation: null, supplierId: null });
  });
  it('常用・請負：行の値 → null は常用 → 項目が無いときだけ保存済み → 常用', () => {
    expect(laborContractValue({ workerId: 'p1', laborContract: 'jouyou' }, stored)).toBe('jouyou');
    expect(laborContractValue({ workerId: 'p1', laborContract: null }, stored)).toBe('jouyou');
    expect(laborContractValue({ workerId: 'p1' }, stored)).toBe('ukeoi');
    expect(laborContractValue({ workerId: 'p3' }, stored)).toBe('jouyou');
    expect(laborContractValue({ workerId: 'p3', laborContract: 'ukeoi' }, stored)).toBe('ukeoi');
  });
});

describe('現場の協力会社と作業員の選択肢', () => {
  it('追加できる会社：有効な協力会社で、まだ現場に無い会社（名前順）。取引先だけの会社は出さない', () => {
    const suppliers = [
      { id: S1, name: '山田工務店', active: true, isPartner: true },
      { id: S2, name: '青木設備', active: true, isPartner: true },
      { id: 's3', name: '無効商店', active: false, isPartner: true },
      { id: 's4', name: 'あおい建材', active: true, isPartner: true },
      { id: 's5', name: 'いろは材木店', active: true, isPartner: false },
    ];
    expect(addablePartnerSuppliers(suppliers, [S1]).map((s) => s.id)).toEqual(['s4', S2]);
  });
  it('登録できる作業員：その会社の有効な協力会社の作業員だけ', () => {
    expect(partnerWorkerChoices(workers, S1).map((x) => x.id)).toEqual(['p1']);
    expect(partnerWorkerChoices(workers, S2).map((x) => x.id)).toEqual(['p3']);
  });
});
