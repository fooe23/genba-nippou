import type { ChangeTotals } from '@/lib/calc/change';
import { yen } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { outputBreakdown } from '@/lib/report/contract-work';
import { EMPTY_SUBCONTRACT_OUTPUT, changesWithSubcontract, type SubcontractOutput } from '@/lib/report/subcontract-output';
import type { ReportTotals } from '@/lib/types';
import { ContractWorkWarning } from './ContractWorkWarning';
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
function changeText(c: ChangeTotals | null): string | null {
  if (!c) return null;
  const parts = [
    ['追加', c.extra],
    ['増', c.increase],
    ['変更', c.change],
    ['減', c.minus],
  ] as const;
  const shown = parts.filter(([, v]) => v !== 0).map(([label, v]) => `${label} ${signed(v)}`);
  return shown.length === 0 ? null : shown.join(' ／ ');
}

/** 出来高の行の下に出す小さな内訳の行（「うち外注 ¥170,000」）。 */
function SubLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-1 text-sm text-gray-600 dark:text-gray-400">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * 本日原価集計（5項目と合計、根拠の件を選んだ費用の「うち精算が必要（件の根拠）」）・本日出来高（契約内／追加・変更（精算が必要）／合計）・進捗率（この日までの累計出来高 ÷ 総請負金額）。
 * 外注の支払い（2026-11-11）は出来高に入れる：件を選んでいない外注は契約内（「うち外注」）、件を選んだ外注はその件の区分。
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
  workWarnings = [],
  subcontract = EMPTY_SUBCONTRACT_OUTPUT,
  taggedCost = 0,
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
  /** 作業内容が無い・契約外だけ・人工のずれの知らせ（編集できる画面だけ。1 つ 1 行で出す）。 */
  workWarnings?: readonly string[];
  /** 外注の支払いのうち出来高に数える分（社員・管理者だけ。協力会社には外注の行が無いので 0）。 */
  subcontract?: SubcontractOutput;
  /** 根拠の件を選んだ燃料・リース・現金・買掛（仕入・外注）の合計（taggedCostTotal。協力会社には外注は入らない）。 */
  taggedCost?: number;
}) {
  const split = outputBreakdown(totals.output, changes, subcontract);
  const cumulative = outputBefore + split.total;
  const changeLine = changeText(changesWithSubcontract(changes, subcontract));
  const rate = showMoney && contractAmount ? progressRate(cumulative, contractAmount) * 100 : null;
  return (
    <section aria-label="本日の集計" className="mb-8 grid gap-4 md:grid-cols-2">
      <ContractWorkWarning messages={workWarnings} variant="line" className="md:col-span-2" />
      <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
        <h2 className="mb-1 text-lg font-bold">本日原価集計</h2>
        <dl>
          <Line
            label={`労務費（${totals.workerCount}人・${decimal(totals.manDays)}人工${totals.overtimeHours > 0 ? `・残業 ${decimal(totals.overtimeHours)} H` : ''}）`}
            value={money(totals.labor)}
          />
          {/* 請負の会社の人工（うち常用の時間の外）は出面だけで、労務費（原価）に数えない（2026-11-17）。 */}
          {totals.ukeoiManDays > 0 && (
            <div className="flex items-baseline justify-between gap-3 pb-1 text-sm text-gray-600 dark:text-gray-400">
              <dt>うち請負の人工（原価に数えない）</dt>
              <dd className="tabular-nums">{decimal(totals.ukeoiManDays)}人工</dd>
            </div>
          )}
          <Line label="燃料費" value={money(totals.fuel)} />
          <Line label="リース費" value={money(totals.lease)} />
          <Line label="現金購入" value={money(totals.cash)} />
          {totals.subcontract !== 0 ? (
            <>
              {/* 外注の買掛（2026-11-17。社員・管理者の画面だけに行がある）は仕入と分けて出す。合計には 1 回だけ入る。 */}
              <Line label="買掛（仕入）" value={money(totals.credit - totals.subcontract)} />
              <Line label="外注" value={money(totals.subcontract)} />
            </>
          ) : (
            <Line label="買掛" value={money(totals.credit)} />
          )}
          <Line label="本日原価 合計" value={money(totals.cost)} strong />
          {/* 根拠に件を選んだ費用は契約外（あとで件ごとに精算する分。2026-11-11）。労務は入れない。 */}
          {taggedCost !== 0 && (
            <div className="flex items-baseline justify-between gap-3 rounded bg-amber-50 px-1 py-1 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
              <dt>うち精算が必要（件の根拠）</dt>
              <dd className="font-bold tabular-nums">{money(taggedCost)}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
        <h2 className="mb-1 text-lg font-bold">出来高</h2>
        <dl>
          <Line label="契約内の出来高" value={money(split.contract)} />
          {split.subcontractContract !== 0 && <SubLine label="うち外注" value={money(split.subcontractContract)} />}
          {/* 契約外（追加・増・変更・減）は区分ごとに出す（減は負）。あとで件ごとに精算する分。 */}
          <div
            className={`flex flex-wrap items-baseline justify-between gap-x-3 py-1 ${changeLine ? 'rounded bg-amber-50 px-1 text-amber-950 dark:bg-amber-950 dark:text-amber-50' : ''}`}
          >
            <dt>追加・変更（精算が必要）</dt>
            <dd className="font-bold tabular-nums">{changeLine ?? 'なし'}</dd>
          </div>
          {split.subcontractChanges !== 0 && <SubLine label="うち外注" value={signed(split.subcontractChanges)} />}
          <Line label="本日出来高 合計" value={money(split.total)} />
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
