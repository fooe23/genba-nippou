import { NO_REPORTS } from '@/lib/reports/cost-sections';
import { toCsv } from '@/lib/reports/csv';
import { DAILY_CSV_COLUMNS, LINE_KIND_LABELS, withManual, workDescription } from '@/lib/reports/daily-sections';
import type { DailyReportModel } from '@/lib/reports/types';

// 日報の CSV（純関数）。明細 1 行 1 レコード、列は DAILY_CSV_COLUMNS（21 列）。1 日分も月まとめも同じ形で、
// 渡した日報の順に 作業員→車両→リース→現金購入→買掛→作業内容 の順で並べる。日報の無い日（isEmpty）は出さない。
// レコードが 1 件も無いとき（日報の無い日・月）は「日報がありません」の 1 行（日付＝最初のモデルの date、種別＝その文、他は空）。
// 値はモデルの数値のまま（金額の桁区切りなし）。空欄・決められない値は空。

type Value = string | number | null;

/** 列名 → 値。書かない列は空欄。 */
type CsvRecord = Partial<{ [K in (typeof DAILY_CSV_COLUMNS)[number]]: Value }>;

function dayRecords(m: DailyReportModel): CsvRecord[] {
  const h = m.header;
  const base = (kind: keyof typeof LINE_KIND_LABELS): CsvRecord => ({
    日付: h.date,
    '回目(当月)': h.monthIndex,
    通算: h.totalIndex,
    種別: LINE_KIND_LABELS[kind],
  });
  return [
    ...m.workers.rows.map((r) => ({
      ...base('labor'),
      名前: withManual(r.name, r.manual),
      単価: r.dailyRate,
      金額: r.cost,
      開始: r.start,
      終了: r.end,
      休憩分: r.breakMin,
      中抜分: r.gapMin,
      実働H: r.hours,
      人工: r.manDays,
      残業H: r.overtimeHours,
      備考: r.note,
    })),
    ...m.vehicles.rows.map((r) => ({
      ...base('fuel'),
      名前: withManual(r.name, r.manual),
      // 規格に燃費、数量に走行距離（km）、単価に燃料単価（円/L）。
      規格: r.kmPerL !== null ? `${r.kmPerL}km/L` : null,
      単位: 'km',
      数量: r.distanceKm,
      単価: r.pricePerL,
      金額: r.cost,
      備考: r.note,
    })),
    ...m.leases.rows.map((r) => ({
      ...base('lease'),
      名前: withManual(r.name, r.manual),
      規格: r.spec,
      単位: r.unit,
      数量: r.qty,
      単価: r.unitPrice,
      金額: r.amount,
      備考: r.note,
    })),
    ...(['cash', 'credit'] as const).flatMap((kind) =>
      m[kind].rows.map((r) => ({
        ...base(kind),
        名前: r.name,
        規格: r.spec,
        単位: r.unit,
        数量: r.qty,
        単価: r.unitPrice,
        金額: r.amount,
        取引先: withManual(r.vendor, r.vendorManual),
      })),
    ),
    ...m.work.rows.map((r) => ({
      ...base('work'),
      単位: r.unit,
      数量: r.qty,
      単価: r.unitPrice,
      金額: r.amount,
      人工: r.manDays,
      工種: r.trade,
      // 追加・増・変更・減は頭に【区分】（列は増やさない）。
      施工内容: workDescription(r),
    })),
  ];
}

/** 日報（1 日分または月の全日分）の CSV。レコードが無ければ見出しの行と「日報がありません」の 1 行。 */
export function buildDailyCsv(models: DailyReportModel[]): string {
  const days = models.filter((m) => !m.isEmpty).flatMap(dayRecords);
  const records: CsvRecord[] = days.length > 0 ? days : [{ 日付: models[0]?.header.date ?? null, 種別: NO_REPORTS }];
  return toCsv([[...DAILY_CSV_COLUMNS], ...records.map((r) => DAILY_CSV_COLUMNS.map((c) => r[c] ?? null))]);
}
