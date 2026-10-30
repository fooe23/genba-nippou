import { yen } from '@/lib/calc/format';
import type { AttendanceRow } from '@/lib/calc/aggregate';
import { manDaysText, tableClass, tableWrapClass, tdClass, tdStickyClass, thClass, thStickyClass } from './table';

/** 出面一覧。作業員 × 日付。セルは上段が人工、下段が労務費。 */
export function AttendanceTable({ rows }: { rows: AttendanceRow[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-base text-gray-600 dark:text-gray-400">この期間の出面はありません。</p>;
  }
  const dates = [...new Set(rows.flatMap((r) => Object.keys(r.byDate)))].sort();
  return (
    <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead>
          <tr>
            <th scope="col" className={thStickyClass}>作業員</th>
            {dates.map((d) => (
              <th key={d} scope="col" className={thClass}>{Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}</th>
            ))}
            <th scope="col" className={thClass}>稼働日数</th>
            <th scope="col" className={thClass}>人工計</th>
            <th scope="col" className={thClass}>労務費計</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.workerName}>
              <th scope="row" className={`${tdStickyClass} font-bold`}>{r.workerName}</th>
              {dates.map((d) => {
                const c = r.byDate[d];
                return (
                  <td key={d} className={tdClass}>
                    {c ? (
                      <>
                        <div>{manDaysText(c.manDays)}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{yen(c.cost)}</div>
                      </>
                    ) : (
                      ''
                    )}
                  </td>
                );
              })}
              <td className={tdClass}>{r.workDays}</td>
              <td className={`${tdClass} font-bold`}>{manDaysText(r.manDays)}</td>
              <td className={`${tdClass} font-bold`}>{yen(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
