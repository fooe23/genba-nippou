import { describe, expect, it } from 'vitest';
import { emptyBreakdown } from '@/lib/reports/change-model';
import { breakdownParts, breakdownText, proposalFormulaText, ratePercent } from '@/lib/reports/settlement-breakdown';

const DEF = { legalWelfareRate: 0.151, materialExpenseRate: 0.12, leaseFuelExpenseRate: 0.12, overheadProfitRate: 0.08 };

describe('件の精算の内訳の表示（社内用）', () => {
  it('率の表示（0.151 → 15.1、0.08 → 8）', () => {
    expect([0.151, 0.12, 0.08, 0, 0.125].map(ratePercent)).toEqual(['15.1', '12', '8', '0', '12.5']);
  });
  it('0 円の項目は出さず、労務（施工金額）・材料・リース・燃料・外注の順。外注は率なし', () => {
    const b = { ...emptyBreakdown(), laborAmount: 25000, laborCost: 20000, material: 25000, fuel: 800, subcontract: 170000 };
    expect(breakdownParts(b, DEF)).toEqual([
      { label: '労務（施工金額）', amount: 25000, rate: '法定福利費 15.1%' },
      { label: '材料', amount: 25000, rate: '材料経費 12%' },
      { label: '燃料', amount: 800, rate: '経費 12%' },
      { label: '外注', amount: 170000, rate: '率なし' },
    ]);
    expect(breakdownText(b, DEF)).toBe('労務（施工金額） ¥25,000／材料 ¥25,000／燃料 ¥800／外注 ¥170,000');
    expect(breakdownText(emptyBreakdown(), DEF)).toBe('');
  });
  it('式の文言', () => {
    expect(proposalFormulaText(DEF)).toContain('×(1＋諸経費率 8%)＋外注、円未満切り上げ。');
  });
});
