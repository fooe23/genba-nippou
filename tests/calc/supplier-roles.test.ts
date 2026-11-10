import { describe, expect, it } from 'vitest';
import {
  creditSupplierError,
  materialCreditSupplierIds,
  MSG_SUBCONTRACT_SUPPLIER,
  subcontractSupplierError,
  isPartnerSupplier,
  MSG_NOT_PARTNER,
  MSG_NOT_VENDOR,
  nonVendorAdditions,
  partnerChoices,
  vendorSuppliers,
  type SupplierRoles,
} from '@/lib/calc/supplier-roles';

const suppliers = [
  { id: 'v', name: '材木店', active: true, isVendor: true, isPartner: false },
  { id: 'p', name: '内装工業', active: true, isVendor: false, isPartner: true },
  { id: 'b', name: '設備工業', active: true, isVendor: true, isPartner: true },
  { id: 'px', name: '廃業工務店', active: false, isVendor: false, isPartner: true },
];

const roles: SupplierRoles = new Map(suppliers.map((s) => [s.id, { isVendor: s.isVendor, isPartner: s.isPartner }]));

describe('協力会社の選択肢', () => {
  it('有効な協力会社だけ（両方の印の会社も含む）', () => {
    expect(partnerChoices(suppliers).map((s) => s.id)).toEqual(['p', 'b']);
  });
  it('いま選んでいる会社は、無効・取引先だけでも残す', () => {
    expect(partnerChoices(suppliers, 'px').map((s) => s.id)).toEqual(['p', 'b', 'px']);
    expect(partnerChoices(suppliers, 'v').map((s) => s.id)).toEqual(['v', 'p', 'b']);
  });
  it('isPartnerSupplier：協力会社の印のある会社だけ true。読めない会社は false', () => {
    expect(isPartnerSupplier(roles, 'p')).toBe(true);
    expect(isPartnerSupplier(roles, 'b')).toBe(true);
    expect(isPartnerSupplier(roles, 'v')).toBe(false);
    expect(isPartnerSupplier(roles, 'unknown')).toBe(false);
    expect(MSG_NOT_PARTNER).toBe('協力会社として登録された会社を選んでください');
  });
});

describe('買掛の相手先', () => {
  it('取引先の印のある会社＋すでに使っている会社', () => {
    expect(vendorSuppliers(suppliers).map((s) => s.id)).toEqual(['v', 'b']);
    expect(vendorSuppliers(suppliers, ['p']).map((s) => s.id)).toEqual(['v', 'p', 'b']);
  });
  it('nonVendorAdditions：取引先の印が無く、保存済みでもない会社だけ（重複なし）', () => {
    expect(nonVendorAdditions(['v', 'p', 'p', 'b', 'px'], roles)).toEqual(['p', 'px']);
    expect(nonVendorAdditions(['v', 'p', 'px'], roles, ['p'])).toEqual(['px']);
  });
  it('nonVendorAdditions：読めない会社は判断しない（止めない）', () => {
    expect(nonVendorAdditions(['unknown'], roles)).toEqual([]);
  });
});

describe('日報の保存：買掛の行の会社', () => {
  it('取引先だけなら通す', () => {
    expect(creditSupplierError(['v', 'b'], roles, [])).toBeNull();
  });
  it('新しく協力会社だけの会社を買掛にしたら止める', () => {
    expect(creditSupplierError(['v', 'p'], roles, [])).toBe(MSG_NOT_VENDOR);
    expect(MSG_NOT_VENDOR).toBe('協力会社は買掛にできません。作業員の行で記録してください');
  });
  it('この日報に保存済みの会社は、後から協力会社だけになっても保存し直せる', () => {
    expect(creditSupplierError(['p'], roles, ['p'])).toBeNull();
    expect(creditSupplierError(['p', 'px'], roles, ['p'])).toBe(MSG_NOT_VENDOR);
  });
  it('買掛の行が無ければ通す', () => {
    expect(creditSupplierError([], roles, [])).toBeNull();
  });
});

describe('日報の保存：外注の買掛の支払先（2026-11-17）', () => {
  it('外注 × 協力会社は通す（両方の印の会社も）', () => {
    expect(subcontractSupplierError([{ purchaseKind: 'subcontract', supplierId: 'p' }, { purchaseKind: 'subcontract', supplierId: 'b' }], roles)).toBeNull();
  });
  it('外注 × 取引先だけの会社・手入力（支払先なし）は止める', () => {
    expect(subcontractSupplierError([{ purchaseKind: 'subcontract', supplierId: 'v' }], roles)).toBe(MSG_SUBCONTRACT_SUPPLIER);
    expect(subcontractSupplierError([{ purchaseKind: 'subcontract', supplierId: null }], roles)).toBe(MSG_SUBCONTRACT_SUPPLIER);
    expect(MSG_SUBCONTRACT_SUPPLIER).toBe('外注の支払先は協力会社から選んでください');
  });
  it('仕入の行は見ない', () => {
    expect(subcontractSupplierError([{ purchaseKind: 'material', supplierId: null }, { purchaseKind: 'material', supplierId: 'p' }], roles)).toBeNull();
  });
  it('買掛の会社の検査（creditSupplierError）は仕入の行の会社だけ：外注の行の協力会社だけの会社で止めない', () => {
    const lines = [
      { kind: 'credit' as const, purchaseKind: 'subcontract' as const, supplierId: 'p' },
      { kind: 'credit' as const, purchaseKind: 'material' as const, supplierId: 'v' },
      { kind: 'credit' as const, purchaseKind: 'material' as const, supplierId: null },
      { kind: 'cash' as const },
    ];
    expect(materialCreditSupplierIds(lines)).toEqual(['v']);
    expect(creditSupplierError(materialCreditSupplierIds(lines), roles, [])).toBeNull();
  });
});
