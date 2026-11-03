import { money } from '@/components/report/form-state';
import type { ChangesRow, ChangesTotal, ChangesUnlinkedRow } from '@/lib/reports/changes-page';
import { CHANGES_COLUMNS, CHANGES_GRID, CHANGES_MIN_WIDTH, CHANGES_ROW, Cell, ComputedCells, KindTag } from '@/components/changes/cells';
import { IssueSettlementRow } from '@/components/changes/IssueSettlementRow';

/** 件に紐づかない追加・増・変更・減の行の合計（入力は無い。精算額は提案額）。 */
function UnlinkedRow({ row }: { row: ChangesUnlinkedRow }) {
  return (
    <li className={`${CHANGES_ROW} ${CHANGES_GRID}`}>
      <Cell label="日付">—</Cell>
      <Cell label="種別">
        <KindTag muted>件なし</KindTag>
      </Cell>
      <Cell label="本文" wide>
        <p>件を選んでいない追加・増・変更・減の行（提案額で数えます）</p>
      </Cell>
      <Cell label="指示者／方法">—</Cell>
      <Cell label="見込み額" num>
        —
      </Cell>
      <Cell label="精算方法">—</Cell>
      <Cell label="確定額／常用単価">—</Cell>
      <Cell label="確定日">—</Cell>
      <ComputedCells row={row} />
      <span className="hidden md:block" />
    </li>
  );
}

function TotalRow({ total }: { total: ChangesTotal }) {
  return (
    <div
      className={`grid grid-cols-2 items-start gap-2 rounded-lg border border-blue-700 bg-blue-50 p-3 font-bold md:items-center md:gap-x-2 md:rounded-none md:border-0 md:border-t-2 md:px-0 md:py-2 dark:border-blue-400 dark:bg-blue-950 ${CHANGES_GRID}`}
    >
      <p className="col-span-2 md:col-span-10">合計（やり直しを除く）</p>
      <Cell label="実績原価合計" num>
        {money(total.actualCost)}
      </Cell>
      <Cell label="提案額合計" num>
        {money(total.proposal)}
      </Cell>
      <Cell label="精算額合計" num>
        {money(total.settled)}
      </Cell>
    </div>
  );
}

/**
 * 「追加・変更の一覧」：現場の全部の件（日報日順）と、件に紐づかない行の合計、合計の行。
 * md 以上は表（横にはみ出す分はスクロール）、md 未満は件ごとのカード。
 */
export function ChangesTable({
  siteId,
  rows,
  total,
  defaultDailyRate,
  readOnly,
}: {
  siteId: string;
  rows: ChangesRow[];
  total: ChangesTotal;
  defaultDailyRate: number | null;
  readOnly: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-base text-gray-600 dark:text-gray-400">追加・変更の件はまだありません。日報の重要事項で件を追加すると、ここに出ます。</p>;
  }
  return (
    <div className="md:overflow-x-auto">
      <div className={CHANGES_MIN_WIDTH}>
        <div
          aria-hidden="true"
          className={`hidden gap-x-2 border-b border-gray-300 pb-1 text-sm font-bold text-gray-700 md:grid dark:border-gray-700 dark:text-gray-300 ${CHANGES_GRID}`}
        >
          {CHANGES_COLUMNS.map((label, i) => (
            <span key={i} className={i === 4 || (i >= 8 && i <= 12) ? 'text-right' : ''}>
              {label}
            </span>
          ))}
        </div>
        <ul className="space-y-3 md:space-y-0">
          {rows.map((row) =>
            row.unlinked ? (
              <UnlinkedRow key="unlinked" row={row} />
            ) : (
              <IssueSettlementRow key={row.id} row={row} siteId={siteId} defaultDailyRate={defaultDailyRate} readOnly={readOnly} />
            ),
          )}
        </ul>
        <div className="mt-3 md:mt-0">
          <TotalRow total={total} />
        </div>
      </div>
    </div>
  );
}
