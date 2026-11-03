'use client';

import { useState } from 'react';
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/masters/common';

/** 出力できる月（日報のある月）。notice は原本 Excel に入りきらないときの案内文。 */
export interface ExportMonthOption {
  /** 'YYYY-MM' */
  month: string;
  label: string;
  reportCount: number;
  notice: string | null;
}

/**
 * 出力画面：原本 Excel（.xlsm、月ごと）、工事原価集計表（工期全体または月、PDF・Excel・CSV）、日報（1 日分または月まとめ、PDF・CSV）。
 * today は日報の日付の初期値（JST の 'YYYY-MM-DD'）。
 */
export function ExportPanel({ siteId, months, today }: { siteId: string; months: ExportMonthOption[]; today: string }) {
  const [month, setMonth] = useState(months[0]?.month ?? '');
  const current = months.find((m) => m.month === month) ?? months[0];
  if (!current) return null;

  const href = `/api/export?site=${encodeURIComponent(siteId)}&month=${encodeURIComponent(current.month)}`;
  const xlsmLabel = '原本 Excel（.xlsm）をダウンロード';

  return (
    <div className="space-y-6">
      <Field label="出力する月">
        <select value={current.month} onChange={(e) => setMonth(e.target.value)} className={inputClass}>
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {m.label}（日報 {m.reportCount} 件）
            </option>
          ))}
        </select>
      </Field>

      <section aria-labelledby="export-xlsm">
        <h2 id="export-xlsm" className="mb-1 text-lg font-bold">
          現場管理台帳（原本 Excel）
        </h2>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
          V34 の雛形に {current.label} の日報を書き込みます。作成に数秒かかります。
        </p>
        {current.notice ? (
          <>
            <button type="button" disabled className={`${primaryButtonClass} w-full`}>
              {xlsmLabel}
            </button>
            <p
              role="alert"
              className="mt-2 rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-50"
            >
              {current.notice}
            </p>
          </>
        ) : (
          <a href={href} className={`${primaryButtonClass} flex w-full items-center justify-center`}>
            {xlsmLabel}
          </a>
        )}
      </section>

      <CostReportSection siteId={siteId} months={months} />
      <DailyReportSection siteId={siteId} months={months} today={today} />
    </div>
  );
}

const COST_FORMATS = [
  { format: 'pdf', label: 'PDF' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'csv', label: 'CSV' },
] as const;

/** 工事原価集計表：集計期間（工期全体／日報のある月）を選び、PDF・Excel・CSV をダウンロードする。 */
function CostReportSection({ siteId, months }: { siteId: string; months: ExportMonthOption[] }) {
  const [period, setPeriod] = useState('all');
  const href = (format: string) =>
    `/api/reports/cost?site=${encodeURIComponent(siteId)}&period=${encodeURIComponent(period)}&format=${format}`;
  return (
    <section aria-labelledby="export-cost">
      <h2 id="export-cost" className="mb-1 text-lg font-bold">
        工事原価集計表
      </h2>
      <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
        原価・採算・推移・作業員・取引先・工種別出来高をまとめた集計表です。
      </p>
      <Field label="集計期間">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
          <option value="all">工期全体</option>
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {COST_FORMATS.map(({ format, label }) => (
          <a
            key={format}
            href={href(format)}
            className={`${format === 'pdf' ? primaryButtonClass : secondaryButtonClass} flex items-center justify-center`}
          >
            {label}
          </a>
        ))}
      </div>
    </section>
  );
}

const DAILY_FORMATS = [
  { format: 'pdf', label: 'PDF' },
  { format: 'csv', label: 'CSV' },
] as const;

/** PDF・CSV のダウンロード。query が null（日付が空）なら押せないボタン。 */
function DailyButtons({ query }: { query: string | null }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {DAILY_FORMATS.map(({ format, label }) => {
        const className = format === 'pdf' ? primaryButtonClass : secondaryButtonClass;
        return query === null ? (
          <button key={format} type="button" disabled className={className}>
            {label}
          </button>
        ) : (
          <a key={format} href={`/api/reports/daily?${query}&format=${format}`} className={`${className} flex items-center justify-center`}>
            {label}
          </a>
        );
      })}
    </div>
  );
}

/** 日報：1 日分（日付を選ぶ）と月まとめ（日報のある月を選ぶ。日ごとに改ページ）を PDF・CSV でダウンロードする。 */
function DailyReportSection({ siteId, months, today }: { siteId: string; months: ExportMonthOption[]; today: string }) {
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(months[0]?.month ?? '');
  const site = `site=${encodeURIComponent(siteId)}`;
  return (
    <section aria-labelledby="export-daily">
      <h2 id="export-daily" className="mb-1 text-lg font-bold">
        日報
      </h2>
      <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
        1 日分、または 1 か月分（日ごとに改ページ）の日報です。日報の無い日は「日報がありません」と出ます。
      </p>
      <Field label="1 日分（日付）">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </Field>
      <DailyButtons query={date ? `${site}&date=${encodeURIComponent(date)}` : null} />
      <div className="mt-4">
        <Field label="1 か月分（月）">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass}>
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.label}（日報 {m.reportCount} 件）
              </option>
            ))}
          </select>
        </Field>
      </div>
      <DailyButtons query={month ? `${site}&month=${encodeURIComponent(month)}` : null} />
    </section>
  );
}
