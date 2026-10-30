import { yen } from '@/lib/calc/format';
import type { CostSummary } from '@/lib/calc/aggregate';
import { NULL_TEXT, pct, tableClass, tableWrapClass, tdClass, tdStickyClass, thClass, thStickyClass, totalClass } from './table';

const ITEMS = [
  { key: 'labor', label: '労務費' },
  { key: 'fuel', label: '燃料費' },
  { key: 'lease', label: 'リース費' },
  { key: 'cash', label: '現場現金購入' },
  { key: 'credit', label: '買掛費' },
] as const;

/** 現場原価集計。5 項目の金額と構成比、原価合計、粗利。 */
export function CostTable({ summary }: { summary: CostSummary }) {
  const s = summary;
  return (
    <div className="space-y-4">
      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col" className={thStickyClass}>項目</th>
              <th scope="col" className={thClass}>金額</th>
              <th scope="col" className={thClass}>構成比</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((it) => (
              <tr key={it.key}>
                <th scope="row" className={`${tdStickyClass} font-normal`}>{it.label}</th>
                <td className={tdClass}>{yen(s[it.key])}</td>
                <td className={tdClass}>{pct(s.shares[it.key])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={totalClass}>
              <th scope="row" className={`${tdStickyClass} ${totalClass}`}>原価合計</th>
              <td className={tdClass}>{yen(s.cost)}</td>
              <td className={tdClass}>{s.cost === 0 ? pct(0) : pct(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={tableWrapClass}>
        <table className={tableClass}>
          <tbody>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>工事総請負金額</th>
              <td className={tdClass}>{s.contractTotal === null ? NULL_TEXT : yen(s.contractTotal)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>総原価</th>
              <td className={tdClass}>{yen(s.cost)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>粗利益</th>
              <td className={tdClass}>{s.grossProfit === null ? NULL_TEXT : yen(s.grossProfit)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>粗利率</th>
              <td className={tdClass}>{s.grossMargin === null ? NULL_TEXT : pct(s.grossMargin)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>進捗率</th>
              <td className={tdClass}>{s.contractTotal === null ? NULL_TEXT : pct(s.progress)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        粗利益・粗利率・進捗率は、表示期間の原価・出来高と工事総請負金額から計算しています。
      </p>
    </div>
  );
}
