import { yen } from '@/lib/calc/format';
import type { ChangeRates, SettlementBreakdown } from '@/lib/reports/types';

// 件の精算の内訳・率の表示（社内だけ。客先用の資料・画面には出さない）。画面（追加・変更の一覧）と社内確認用の PDF・Excel で共通。

/** 施工金額の無い追加・増・変更の行の知らせ（日報の作業内容の行・追加・変更の一覧）。 */
export const MISSING_AMOUNT_WARNING = '精算の金額（施工単価）が入っていません';
/** 知らせの補足（どう数えているか）。 */
export const MISSING_AMOUNT_NOTE = '施工単価が入るまで、人工 × 日当で仮に出しています。';

/** 率の表示（0.151 → '15.1'、0.08 → '8'）。 */
export function ratePercent(rate: number): string {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(Math.round(rate * 1000) / 10);
}

export interface BreakdownPart {
  label: string;
  amount: number;
  /** 掛けた率の説明（外注は「率なし」）。 */
  rate: string;
}

/** 内訳の項目（0 円の項目は除く）。労務（施工金額）・材料・リース・燃料・外注の順。 */
export function breakdownParts(b: SettlementBreakdown, rates: ChangeRates): BreakdownPart[] {
  const parts: BreakdownPart[] = [
    { label: '労務（施工金額）', amount: b.laborAmount, rate: `法定福利費 ${ratePercent(rates.legalWelfareRate)}%` },
    { label: '材料', amount: b.material, rate: `材料経費 ${ratePercent(rates.materialExpenseRate)}%` },
    { label: 'リース', amount: b.lease, rate: `経費 ${ratePercent(rates.leaseFuelExpenseRate)}%` },
    { label: '燃料', amount: b.fuel, rate: `経費 ${ratePercent(rates.leaseFuelExpenseRate)}%` },
    { label: '外注', amount: b.subcontract, rate: '率なし' },
  ];
  return parts.filter((p) => p.amount !== 0);
}

/** 「労務（施工金額） ¥25,000／材料 ¥25,000」（項目が無ければ ''）。 */
export function breakdownText(b: SettlementBreakdown, rates: ChangeRates): string {
  return breakdownParts(b, rates)
    .map((p) => `${p.label} ${yen(p.amount)}`)
    .join('／');
}

/** 提案額の式（社内確認用の注記・ガイドと同じ文言）。 */
export function proposalFormulaText(rates: ChangeRates): string {
  return (
    `提案額＝（労務（施工金額）×(1＋法定福利費率 ${ratePercent(rates.legalWelfareRate)}%)` +
    `＋材料×(1＋材料経費率 ${ratePercent(rates.materialExpenseRate)}%)` +
    `＋(リース＋燃料)×(1＋リース燃料経費率 ${ratePercent(rates.leaseFuelExpenseRate)}%)）` +
    `×(1＋諸経費率 ${ratePercent(rates.overheadProfitRate)}%)＋外注、円未満切り上げ。減は申告額。`
  );
}
