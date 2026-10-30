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

/**
 * 現場原価集計。上の表は「表示期間」の 5 項目の金額・構成比・原価合計、
 * 下の表は契約額まわりを「期間末時点の累計」で出す（進捗率は累計出来高 ÷ 工事総請負金額）。
 */
export function CostTable({
  periodSummary,
  cumulativeSummary,
  periodLabel,
}: {
  periodSummary: CostSummary;
  cumulativeSummary: CostSummary;
  periodLabel: string;
}) {
  const s = periodSummary;
  const c = cumulativeSummary;
  return (
    <div className="space-y-4">
      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col" className={thStickyClass}>項目（表示期間：{periodLabel}）</th>
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
          <thead>
            <tr>
              <th scope="col" className={thStickyClass}>契約額まわり（期間末時点の累計）</th>
              <th scope="col" className={thClass}>金額・率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>工事総請負金額</th>
              <td className={tdClass}>{c.contractTotal === null ? NULL_TEXT : yen(c.contractTotal)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>総原価</th>
              <td className={tdClass}>{yen(c.cost)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>粗利益</th>
              <td className={tdClass}>{c.grossProfit === null ? NULL_TEXT : yen(c.grossProfit)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>粗利率</th>
              <td className={tdClass}>{c.grossMargin === null ? NULL_TEXT : pct(c.grossMargin)}</td>
            </tr>
            <tr>
              <th scope="row" className={`${tdStickyClass} font-normal`}>進捗率</th>
              <td className={tdClass}>{c.contractTotal === null ? NULL_TEXT : pct(c.progress)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        上の表は表示期間だけの原価です。下の表の総原価・粗利益・粗利率・進捗率は、着工から表示期間の末日までの累計（累計原価・累計出来高）と工事総請負金額から計算しており、月次集計の進捗率と一致します。
      </p>
    </div>
  );
}
