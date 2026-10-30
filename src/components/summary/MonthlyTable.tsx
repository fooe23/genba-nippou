import Link from 'next/link';
import { jpDate, yen } from '@/lib/calc/format';
import { sumRows, type MonthlyRow } from '@/lib/calc/aggregate';
import { NULL_TEXT, pct, tableClass, tableWrapClass, tdClass, tdStickyClass, thClass, thStickyClass, totalClass } from './table';

/** 月次集計（雛形の列順）。日付は日報画面へのリンク。 */
export function MonthlyTable({ siteId, rows, hasContract }: { siteId: string; rows: MonthlyRow[]; hasContract: boolean }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-base text-gray-600 dark:text-gray-400">この期間の日報はありません。</p>;
  }
  const sum = sumRows(rows);
  const last = rows[rows.length - 1];
  return (
    <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead>
          <tr>
            <th scope="col" className={thStickyClass}>日付</th>
            <th scope="col" className={`${thClass} text-left`}>天候</th>
            <th scope="col" className={thClass}>作業員数</th>
            <th scope="col" className={thClass}>労務費</th>
            <th scope="col" className={thClass}>燃料費</th>
            <th scope="col" className={thClass}>リース費</th>
            <th scope="col" className={thClass}>現場現金購入</th>
            <th scope="col" className={thClass}>買掛費</th>
            <th scope="col" className={thClass}>本日原価</th>
            <th scope="col" className={thClass}>工事出来高</th>
            <th scope="col" className={thClass}>進捗率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row" className={`${tdStickyClass} font-normal`}>
                <Link href={`/sites/${siteId}/reports/${r.date}`} className="inline-flex min-h-11 flex-col justify-center text-blue-700 underline dark:text-blue-400">
                  <span className="font-medium">{jpDate(r.date)}</span>
                  <span className="text-xs">当月{r.monthIndex}回目・通算{r.totalIndex}回目</span>
                </Link>
              </th>
              <td className={`${tdClass} text-left`}>{r.weather ?? NULL_TEXT}</td>
              <td className={tdClass}>{r.workerCount}</td>
              <td className={tdClass}>{yen(r.labor)}</td>
              <td className={tdClass}>{yen(r.fuel)}</td>
              <td className={tdClass}>{yen(r.lease)}</td>
              <td className={tdClass}>{yen(r.cash)}</td>
              <td className={tdClass}>{yen(r.credit)}</td>
              <td className={tdClass}>{yen(r.cost)}</td>
              <td className={tdClass}>{yen(r.output)}</td>
              <td className={tdClass}>{hasContract ? pct(r.progress) : NULL_TEXT}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={totalClass}>
            <th scope="row" className={`${tdStickyClass} ${totalClass}`}>合計</th>
            <td className={`${tdClass} text-left`} />
            <td className={tdClass}>{sum.workerCount}</td>
            <td className={tdClass}>{yen(sum.labor)}</td>
            <td className={tdClass}>{yen(sum.fuel)}</td>
            <td className={tdClass}>{yen(sum.lease)}</td>
            <td className={tdClass}>{yen(sum.cash)}</td>
            <td className={tdClass}>{yen(sum.credit)}</td>
            <td className={tdClass}>{yen(sum.cost)}</td>
            <td className={tdClass}>{yen(sum.output)}</td>
            <td className={tdClass}>{hasContract ? pct(last.progress) : NULL_TEXT}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
