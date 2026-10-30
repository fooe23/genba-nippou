import { yen } from '@/lib/calc/format';
import type { WorkerCumulativeRow } from '@/lib/calc/aggregate';
import { manDaysText, tableClass, tableWrapClass, tdClass, tdStickyClass, thClass, thStickyClass } from './table';

/** 作業員別累計（Excel 雛形の「作業員別 当月集計」と同じ並び：前月繰越／当期間／累計）。 */
export function WorkersTable({ rows, isAll }: { rows: WorkerCumulativeRow[]; isAll: boolean }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-base text-gray-600 dark:text-gray-400">集計できる出面がありません。</p>;
  }
  const excluded = rows.filter((r) => r.excludedCount > 0);
  return (
    <div className="space-y-2">
      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={thStickyClass}>作業員</th>
              <th scope="colgroup" colSpan={2} className={thClass}>前月繰越</th>
              <th scope="colgroup" colSpan={2} className={thClass}>当期間</th>
              <th scope="colgroup" colSpan={2} className={thClass}>累計</th>
            </tr>
            <tr>
              <th scope="col" className={thClass}>人工</th>
              <th scope="col" className={thClass}>労務費</th>
              <th scope="col" className={thClass}>人工</th>
              <th scope="col" className={thClass}>労務費</th>
              <th scope="col" className={thClass}>人工</th>
              <th scope="col" className={thClass}>労務費</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.workerId ?? `name:${r.workerName}`}>
                <th scope="row" className={`${tdStickyClass} font-bold`}>{r.workerName}</th>
                <td className={tdClass}>{manDaysText(r.carryManDays)}</td>
                <td className={tdClass}>{yen(r.carryCost)}</td>
                <td className={tdClass}>{manDaysText(r.manDays)}</td>
                <td className={tdClass}>{yen(r.cost)}</td>
                <td className={`${tdClass} font-bold`}>{manDaysText(r.totalManDays)}</td>
                <td className={`${tdClass} font-bold`}>{yen(r.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        前月繰越 = 繰越初期値 + 表示期間より前の日報{isAll ? '（工期全体の表示では繰越初期値だけ）' : ''}。累計 = 前月繰越 + 当期間
      </p>
      {excluded.length > 0 && (
        <p role="status" className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50">
          繰越の基準日より前の日報は、繰越初期値に含まれているものとして集計に入れていません：
          {excluded.map((r) => `${r.workerName} ${r.excludedCount}件`).join('、')}
        </p>
      )}
    </div>
  );
}
