import { yen } from '@/lib/calc/format';
import type { WorkerCumulativeRow } from '@/lib/calc/aggregate';
import { manDaysText, tableClass, tableWrapClass, tdClass, tdStickyClass, thClass, thStickyClass } from './table';

/** 作業員別累計。累計 = 繰越初期値 + 表示期間。 */
export function WorkersTable({ rows }: { rows: WorkerCumulativeRow[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-base text-gray-600 dark:text-gray-400">集計できる出面がありません。</p>;
  }
  return (
    <div className="space-y-2">
      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col" className={thStickyClass}>作業員</th>
              <th scope="col" className={thClass}>繰越人工</th>
              <th scope="col" className={thClass}>繰越労務費</th>
              <th scope="col" className={thClass}>当期間人工</th>
              <th scope="col" className={thClass}>当期間労務費</th>
              <th scope="col" className={thClass}>累計人工</th>
              <th scope="col" className={thClass}>累計労務費</th>
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
      <p className="text-sm text-gray-600 dark:text-gray-400">累計 = 繰越初期値 + 表示期間</p>
    </div>
  );
}
