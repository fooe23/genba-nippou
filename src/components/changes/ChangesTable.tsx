import Link from 'next/link';
import { money } from '@/components/report/form-state';
import { jpDate } from '@/lib/calc/format';
import type { ChangesRow, ChangesTotal, ChangesUnlinkedRow, PossibleDuplicate } from '@/lib/reports/changes-page';
import { AffiliationNote, CHANGES_COLUMNS, CHANGES_GRID, CHANGES_MIN_WIDTH, CHANGES_ROW, Cell, ComputedCells, KindTag } from '@/components/changes/cells';
import { IssueSettlementRow } from '@/components/changes/IssueSettlementRow';

/** 'YYYY-MM-DD' → 「11/03」（年が違う日が混ざるときは「2026/11/03」）。 */
function shortDate(date: string, withYear: boolean): string {
  return withYear ? date.replaceAll('-', '/') : date.slice(5).replace('-', '/');
}

/**
 * 件に紐づかない追加・増・変更・減の行の合計（入力は無い。精算額は提案額）。
 * その行のある日報の日付を本文の欄に並べる（日報へのリンク。折り返すので見切れない）。日付の欄は日数だけ。
 */
function UnlinkedRow({ row, siteId }: { row: ChangesUnlinkedRow; siteId: string }) {
  const withYear = new Set(row.dates.map((d) => d.slice(0, 4))).size > 1;
  return (
    <li className={`${CHANGES_ROW} ${CHANGES_GRID}`}>
      <Cell label="日付">{row.dates.length > 0 ? `${row.dates.length}日分` : '—'}</Cell>
      <Cell label="種別">
        <KindTag muted>件なし</KindTag>
      </Cell>
      <Cell label="本文" wide>
        <p>件を選んでいない追加・増・変更・減の行（提案額で数えます）</p>
        {row.dates.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">日報で件を選ぶ：</span>
            {row.dates.map((d, i) => (
              <span key={d} className="inline-flex items-center">
                {i > 0 && <span aria-hidden="true">・</span>}
                <Link
                  href={`/sites/${siteId}/reports/${d}`}
                  aria-label={`${jpDate(d)} の日報`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-blue-700 underline dark:text-blue-400"
                >
                  {shortDate(d, withYear)}
                </Link>
              </span>
            ))}
          </div>
        )}
      </Cell>
      <Cell label="指示者／方法">—</Cell>
      <Cell label="見込み額" num>
        —
      </Cell>
      <Cell label="精算方法">—</Cell>
      <Cell label="確定額／常用単価">—</Cell>
      <Cell label="確定日">—</Cell>
      <ComputedCells row={row} />
      <span className="hidden 2xl:block" />
      <AffiliationNote row={row} />
    </li>
  );
}

function TotalRow({ total }: { total: ChangesTotal }) {
  return (
    <div
      className={`grid grid-cols-2 items-start gap-2 rounded-lg border border-blue-700 bg-blue-50 p-3 font-bold 2xl:items-center 2xl:gap-x-1.5 2xl:rounded-none 2xl:border-0 2xl:border-t-2 2xl:px-0 2xl:py-2 dark:border-blue-400 dark:bg-blue-950 ${CHANGES_GRID}`}
    >
      <p className="col-span-2 2xl:col-span-10">合計（やり直しを除く）</p>
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
 * 2xl 以上は表（ページ幅に収まる。万一はみ出す分はスクロール）、2xl 未満は件ごとのカード。
 */
export function ChangesTable({
  siteId,
  rows,
  total,
  defaultDailyRate,
  duplicates = {},
  readOnly,
}: {
  siteId: string;
  rows: ChangesRow[];
  total: ChangesTotal;
  defaultDailyRate: number | null;
  /** 件の id → 重複の可能性（possibleDuplicates）。 */
  duplicates?: Record<string, PossibleDuplicate[]>;
  readOnly: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-base text-gray-600 dark:text-gray-400">追加・変更の件はまだありません。日報の重要事項で件を追加すると、ここに出ます。</p>;
  }
  return (
    <div className="2xl:overflow-x-auto">
      <div className={CHANGES_MIN_WIDTH}>
        <div
          aria-hidden="true"
          className={`hidden gap-x-2 2xl:gap-x-1.5 border-b border-gray-300 pb-1 text-sm font-bold text-gray-700 2xl:grid dark:border-gray-700 dark:text-gray-300 ${CHANGES_GRID}`}
        >
          {CHANGES_COLUMNS.map((label, i) => (
            <span key={i} className={i === 4 || (i >= 8 && i <= 12) ? 'text-right' : ''}>
              {label}
            </span>
          ))}
        </div>
        <ul className="space-y-3 2xl:space-y-0">
          {rows.map((row) =>
            row.unlinked ? (
              <UnlinkedRow key="unlinked" row={row} siteId={siteId} />
            ) : (
              <IssueSettlementRow
                key={row.id}
                row={row}
                siteId={siteId}
                defaultDailyRate={defaultDailyRate}
                duplicates={duplicates[row.id] ?? []}
                readOnly={readOnly}
              />
            ),
          )}
        </ul>
        <div className="mt-3 2xl:mt-0">
          <TotalRow total={total} />
        </div>
      </div>
    </div>
  );
}
