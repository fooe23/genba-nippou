import { describe, expect, it } from 'vitest';
import {
  creditItemLabel,
  MSG_SUBCONTRACT_NOT_READY,
  MSG_SUBCONTRACT_STAFF_ONLY,
  subcontractInputError,
} from '@/lib/report/purchase-kind';
import { issueOptions } from '@/lib/report/issue-options';
import type { Issue } from '@/lib/db/reports';

describe('買掛の品目の表示（帳票。2026-11-17）', () => {
  it('外注の行は頭に【外注・工種名】、工種が無ければ【外注】。仕入はそのまま', () => {
    expect(creditItemLabel({ itemName: 'タイル工事', purchaseKind: 'subcontract' }, 'タイル')).toBe('【外注・タイル】タイル工事');
    expect(creditItemLabel({ itemName: 'タイル工事', purchaseKind: 'subcontract' }, null)).toBe('【外注】タイル工事');
    expect(creditItemLabel({ itemName: '合板', purchaseKind: 'material' }, 'タイル')).toBe('合板');
  });
});

describe('外注の買掛の入力の可否（保存）', () => {
  const sub = { kind: 'credit' as const, purchaseKind: 'subcontract' as const };
  const mat = { kind: 'credit' as const, purchaseKind: 'material' as const };
  it('協力会社のアカウントが外注の行を送ったら止める', () => {
    expect(subcontractInputError([mat, sub], { isStaff: false, ready: true })).toBe(MSG_SUBCONTRACT_STAFF_ONLY);
    expect(MSG_SUBCONTRACT_STAFF_ONLY).toBe('外注の買掛は社員だけが入力できます');
  });
  it('SQL の前（列が無い）なら止める（区分が仕入として保存されて消えないように）', () => {
    expect(subcontractInputError([sub], { isStaff: true, ready: false })).toBe(MSG_SUBCONTRACT_NOT_READY);
  });
  it('仕入だけ・社員なら通す', () => {
    expect(subcontractInputError([mat, { kind: 'cash' as const }], { isStaff: false, ready: false })).toBeNull();
    expect(subcontractInputError([sub], { isStaff: true, ready: true })).toBeNull();
  });
});

describe('根拠の件の選択肢', () => {
  const issue = (id: string, body: string, reportDate = '2026-11-05'): Issue =>
    ({ id, body, reportDate, kind: 'extra' }) as Issue;
  it('「MM/DD 種別 本文の先頭 30 字」、重複は除く', () => {
    const long = 'あ'.repeat(31);
    expect(issueOptions([issue('a', ' 門柱の\nタイル追加 '), issue('a', '重複'), issue('b', long)])).toEqual([
      { value: 'a', label: '11/05 追加指示 門柱の タイル追加', kind: 'extra' },
      { value: 'b', label: `11/05 追加指示 ${'あ'.repeat(30)}…`, kind: 'extra' },
    ]);
  });
});
