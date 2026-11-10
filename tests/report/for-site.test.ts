import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/masters', () => ({ listLeaseItems: vi.fn(), listSuppliers: vi.fn(), listUnits: vi.fn(), listVehicles: vi.fn(), listWeather: vi.fn(), listWorkers: vi.fn() }));
vi.mock('@/lib/db/reports', () => ({ listIssuesForReport: vi.fn(), listOpenIssues: vi.fn(), listReportHeads: vi.fn() }));
vi.mock('@/lib/db/sites', () => ({ getSiteMasters: vi.fn() }));
vi.mock('@/lib/db/settings', () => ({ getSettings: vi.fn() }));

const { creditSuppliersForSite, forSite, subcontractSuppliersForSite, workersForSiteLabor } = await import('@/lib/report/form-props');

const items = [
  { id: 'a', active: true },
  { id: 'b', active: false },
  { id: 'c', active: true },
];

describe('forSite（現場で使うマスターの絞り込み）', () => {
  it('選択があるときは、選択順のうち有効なもの＋使用中のもの', () => {
    expect(forSite(items, ['c', 'b', 'a'], new Set()).map((i) => i.id)).toEqual(['c', 'a']);
    expect(forSite(items, ['c', 'b'], new Set(['b'])).map((i) => i.id)).toEqual(['c', 'b']);
  });
  it('何も選んでいないときは、有効なもの全部（マスターの並び）', () => {
    expect(forSite(items, [], new Set()).map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('何も選んでいなくても、使用中の無効なものは末尾に残す', () => {
    expect(forSite(items, [], new Set(['b'])).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('workersForSiteLabor（日報の作業員の選択肢。すべてのアカウントで同じ）', () => {
  const own = (id: string, active = true) => ({ id, active, affiliation: 'own' as const });
  const partner = (id: string, active = true) => ({ id, active, affiliation: 'partner' as const });
  const workers = [own('o1'), own('o2'), own('o3', false), partner('p1'), partner('p2'), partner('p3', false)];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('何も選んでいない現場：自社の有効な作業員全部。協力会社の作業員は出さない（全員にはしない）', () => {
    expect(ids(workersForSiteLabor(workers, [], new Set()))).toEqual(['o1', 'o2']);
  });
  it('協力会社の作業員だけ登録した現場でも、自社は全員（自社の選択が 0 件）＋登録した協力会社の作業員', () => {
    expect(ids(workersForSiteLabor(workers, ['p2'], new Set()))).toEqual(['o1', 'o2', 'p2']);
  });
  it('自社を選んだ現場：選んだ自社（選択順）→ 登録した協力会社（登録順）。無効な登録は出さない', () => {
    expect(ids(workersForSiteLabor(workers, ['p2', 'o2', 'p3', 'p1'], new Set()))).toEqual(['o2', 'p2', 'p1']);
  });
  it('この日報で使っている作業員は、無効・未登録でも残す', () => {
    expect(ids(workersForSiteLabor(workers, ['o1'], new Set(['p3', 'o3', 'p1'])))).toEqual(['o1', 'o3', 'p3', 'p1']);
  });
});

describe('creditSuppliersForSite（日報の買掛の行の会社）', () => {
  const suppliers = [
    { id: 'v1', active: true, isVendor: true },
    { id: 'p1', active: true, isVendor: false },
    { id: 'v2', active: true, isVendor: true },
    { id: 'p2', active: true, isVendor: false },
  ];
  it('現場で選んでいないときは有効な取引先全部。協力会社だけの会社は出さない', () => {
    expect(creditSuppliersForSite(suppliers, [], new Set()).map((s) => s.id)).toEqual(['v1', 'v2']);
  });
  it('この日報ですでに使っている協力会社だけの会社は残す', () => {
    expect(creditSuppliersForSite(suppliers, [], new Set(['p2'])).map((s) => s.id)).toEqual(['v1', 'v2', 'p2']);
  });
  it('現場で選んだ会社のうち取引先だけを選択順に出す。選んだのが協力会社だけなら選んでいない扱い', () => {
    expect(creditSuppliersForSite(suppliers, ['v2', 'p1'], new Set()).map((s) => s.id)).toEqual(['v2']);
    expect(creditSuppliersForSite(suppliers, ['p1'], new Set()).map((s) => s.id)).toEqual(['v1', 'v2']);
  });
});

describe('subcontractSuppliersForSite（外注の買掛の支払先。2026-11-17）', () => {
  const suppliers = [
    { id: 'v', active: true, isVendor: true, isPartner: false },
    { id: 'p', active: true, isVendor: false, isPartner: true },
    { id: 'b', active: true, isVendor: true, isPartner: true },
    { id: 'px', active: false, isVendor: false, isPartner: true },
  ];
  it('社員・管理者だけ。協力会社のアカウント・SQL の前は undefined（区分の欄を出さない）', () => {
    expect(subcontractSuppliersForSite({ isStaff: false, ready: true, suppliers, sitePartnerIds: ['p'], usedIds: new Set() })).toBeUndefined();
    expect(subcontractSuppliersForSite({ isStaff: true, ready: false, suppliers, sitePartnerIds: ['p'], usedIds: new Set() })).toBeUndefined();
  });
  it('現場の協力会社のうち協力会社の印のある会社（取引先だけの会社は出さない）', () => {
    expect(subcontractSuppliersForSite({ isStaff: true, ready: true, suppliers, sitePartnerIds: ['v', 'b', 'p'], usedIds: new Set() })?.map((s) => s.id)).toEqual(['b', 'p']);
  });
  it('現場の協力会社が無ければ有効な協力会社全部。この日報の外注で使っている会社は無効でも残す', () => {
    expect(subcontractSuppliersForSite({ isStaff: true, ready: true, suppliers, sitePartnerIds: [], usedIds: new Set(['px']) })?.map((s) => s.id)).toEqual(['p', 'b', 'px']);
  });
});
