import type { ChangeTotals } from '@/lib/calc/change';
import { yen } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import type { ReportTotals } from '@/lib/types';
import { decimal, money } from './form-state';

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? 'border-t border-gray-400 pt-2 text-lg font-bold dark:border-gray-500' : ''}`}>
      <dt>{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** 符号つきの円（+12,000 ／ −5,000）。 */
function signed(n: number): string {
  return `${n < 0 ? '−' : '+'}${yen(Math.abs(n)).replace('¥', '')}`;
}

/** 「追加 +12,000 ／ 増 +2,000 ／ 変更 +3,000 ／ 減 −5,000」（0 の区分は出さない。全部 0 なら null）。 */
function changeText(c: ChangeTotals): string | null {
  const parts = [
    ['追加', c.extra],
    ['増', c.increase],
    ['変更', c.change],
    ['減', c.minus],
  ] as const;
  const shown = parts.filter(([, v]) => v !== 0).map(([label, v]) => `${label} ${signed(v)}`);
  return shown.length === 0 ? null : shown.join(' ／ ');
}

/**
 * 本日原価集計（5項目と合計）・本日出来高・進捗率（この日までの累計出来高 ÷ 総請負金額）。
 * 契約が未確定の現場は「総請負金額（未確定）」と「概算金額」を出す（進捗率の基準は請負金額のまま。日報 PDF と同じ）。
 */
export function ReportSummary({
  totals,
  changes,
  outputBefore,
  contractAmount,
  tentative = false,
  estimatedAmount = null,
  showMoney,
}: {
  totals: ReportTotals;
  /** 作業内容の区分ごとの金額（減は負）。 */
  changes: ChangeTotals;
  outputBefore: number;
  contractAmount: number | null;
  /** 契約が未確定の現場。 */
  tentative?: boolean;
  /** 未確定の現場の概算金額。 */
  estimatedAmount?: number | null;
  /** 請負金額・概算金額・進捗率を出すか（社員・管理者だけ true。協力会社は行ごと出さない）。 */
  showMoney: boolean;
}) {
  const cumulative = outputBefore + totals.output;
  const changeLine = changeText(changes);
  const rate = showMoney && contractAmount ? progressRate(cumulative, contractAmount) * 100 : null;
  return (
    <section aria-label="本日の集計" className="mb-8 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
        <h2 className="mb-1 text-lg font-bold">本日原価集計</h2>
        <dl>
          <Line
            label={`労務費（${totals.workerCount}人・${decimal(totals.manDays)}人工${totals.overtimeHours > 0 ? `・残業 ${decimal(totals.overtimeHours)} H` : ''}）`}
            value={money(totals.labor)}
          />
          <Line label="燃料費" value={money(totals.fuel)} />
          <Line label="リース費" value={money(totals.lease)} />
          <Line label="現金購入" value={money(totals.cash)} />
          <Line label="買掛" value={money(totals.credit)} />
          <Line label="本日原価 合計" value={money(totals.cost)} strong />
        </dl>
      </div>
      <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
        <h2 className="mb-1 text-lg font-bold">出来高</h2>
        <dl>
          <Line label="本日出来高" value={money(totals.output)} />
          {changeLine && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm">
              <dt>本日の追加・増・変更・減</dt>
              <dd className="font-bold tabular-nums">{changeLine}</dd>
            </div>
          )}
          <Line label="累計出来高（この日まで）" value={money(cumulative)} />
          {showMoney && (
            <>
              <Line label={tentative ? '総請負金額（未確定）' : '総請負金額'} value={contractAmount === null ? '未設定' : money(contractAmount)} />
              {tentative && <Line label="概算金額" value={estimatedAmount === null ? '—' : money(estimatedAmount)} />}
              <Line label="進捗率" value={rate === null || !Number.isFinite(rate) ? '—' : `${rate.toFixed(1)}%`} strong />
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
