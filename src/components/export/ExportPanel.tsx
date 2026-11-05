'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
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
 * 出力画面：原本 Excel（.xlsm、月ごと）、工事原価集計表（工期全体または月、PDF・Excel・CSV）、
 * 変更増減 精算資料（工期全体または月。客先用「精算のご提案」と社内確認用の 2 組、各 PDF・Excel）、日報（1 日分または月まとめ、PDF・CSV）。
 * PDF は「プレビュー」（新しいタブでブラウザに開く。disposition=inline）と「ダウンロード」の 2 つ。
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
      <ChangeReportSection siteId={siteId} months={months} />
      <DailyReportSection siteId={siteId} months={months} today={today} />
    </div>
  );
}

/** 出力ボタン 1 つ。preview は PDF をブラウザで開く（&disposition=inline、新しいタブ）。 */
interface FormatButton {
  format: string;
  label: string;
  preview?: boolean;
}

const PDF_BUTTONS: readonly FormatButton[] = [
  { format: 'pdf', label: 'PDF プレビュー', preview: true },
  { format: 'pdf', label: 'PDF ダウンロード' },
];

const COST_FORMATS: readonly FormatButton[] = [...PDF_BUTTONS, { format: 'xlsx', label: 'Excel' }, { format: 'csv', label: 'CSV' }];

const CHANGE_FORMATS: readonly FormatButton[] = [...PDF_BUTTONS, { format: 'xlsx', label: 'Excel' }];

/** 同じ期間で出し分ける組（見出しと、クエリに足す文字列）。 */
interface ReportGroup {
  label: string;
  extraQuery: string;
}

const CHANGE_GROUPS: readonly ReportGroup[] = [
  { label: '客先用（精算のご提案）', extraQuery: '&audience=client' },
  { label: '社内確認用', extraQuery: '' },
];

const DAILY_FORMATS: readonly FormatButton[] = [...PDF_BUTTONS, { format: 'csv', label: 'CSV' }];

/**
 * ボタンの並び。スマホ（375px）は 2 列（4 つなら 2×2）、広い画面は 1 行（4 つは「PDF ダウンロード」が折り返さない md 以上）。
 * 数が奇数なら、2 列のときは最後の 1 つを横いっぱいにする。Tailwind がクラス名を拾えるよう、文字列はそのまま書く。
 */
const GRID_COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4' };

function buttonGridClass(count: number): string {
  return `mt-3 grid gap-2 ${GRID_COLS[count] ?? 'grid-cols-2'}`;
}

function buttonClass(b: FormatButton, index: number, count: number): string {
  const base = b.format === 'pdf' ? primaryButtonClass : secondaryButtonClass;
  const span = count % 2 === 1 && index === count - 1 ? ' col-span-2 sm:col-span-1' : '';
  return `${base} flex items-center justify-center${span}`;
}

/** 出力ボタンの並び。query が null（日付が空など）なら押せないボタン。 */
function FormatButtons({ endpoint, query, buttons }: { endpoint: string; query: string | null; buttons: readonly FormatButton[] }) {
  return (
    <div className={buttonGridClass(buttons.length)}>
      {buttons.map((b, i) => {
        const key = `${b.format}:${b.preview ? 'preview' : 'download'}`;
        const className = buttonClass(b, i, buttons.length);
        if (query === null) {
          return (
            <button key={key} type="button" disabled className={className}>
              {b.label}
            </button>
          );
        }
        const href = `${endpoint}?${query}&format=${b.format}${b.preview ? '&disposition=inline' : ''}`;
        return b.preview ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={className}>
            {b.label}
          </a>
        ) : (
          <a key={key} href={href} className={className}>
            {b.label}
          </a>
        );
      })}
    </div>
  );
}

/** 工事原価集計表：集計期間（工期全体／日報のある月）を選び、PDF（プレビュー・ダウンロード）・Excel・CSV を出す。 */
function CostReportSection({ siteId, months }: { siteId: string; months: ExportMonthOption[] }) {
  return (
    <PeriodReportSection
      id="export-cost"
      title="工事原価集計表"
      description="原価・採算・推移・作業員・取引先・工種別出来高をまとめた集計表です。"
      endpoint="/api/reports/cost"
      formats={COST_FORMATS}
      siteId={siteId}
      months={months}
    />
  );
}

/**
 * 変更増減 精算資料：期間（工期全体／日報のある月。2 組で共通）を選び、客先用（精算のご提案。&audience=client）と
 * 社内確認用のそれぞれで PDF（プレビュー・ダウンロード）・Excel を出す。
 */
function ChangeReportSection({ siteId, months }: { siteId: string; months: ExportMonthOption[] }) {
  return (
    <PeriodReportSection
      id="export-changes"
      title="変更増減 精算資料"
      description="客先用は原価を出さず、件ごとの金額と作業の明細を載せます（見積中の件は金額に入れません）。社内確認用は実績原価・提案額も載せます。"
      groups={CHANGE_GROUPS}
      note={
        <Link
          href={`/sites/${siteId}/changes`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline dark:text-blue-400"
        >
          確定額や常用単価は「追加・変更の一覧」で入れます →
        </Link>
      }
      endpoint="/api/reports/changes"
      formats={CHANGE_FORMATS}
      siteId={siteId}
      months={months}
    />
  );
}

/**
 * 期間（工期全体／日報のある月）を選んで、endpoint?site=&period=&format=（PDF は &disposition=inline でプレビュー）を出す帳票の欄。
 * groups があれば、組ごとに小見出しとボタンの並びを出す（期間は共通）。
 */
function PeriodReportSection({
  id,
  title,
  description,
  note,
  groups,
  endpoint,
  formats,
  siteId,
  months,
}: {
  id: string;
  title: string;
  description: string;
  /** 説明の下に出す 1 行（関連する画面へのリンクなど）。 */
  note?: ReactNode;
  groups?: readonly ReportGroup[];
  endpoint: string;
  formats: readonly FormatButton[];
  siteId: string;
  months: ExportMonthOption[];
}) {
  const [period, setPeriod] = useState('all');
  const query = `site=${encodeURIComponent(siteId)}&period=${encodeURIComponent(period)}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-1 text-lg font-bold">
        {title}
      </h2>
      <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">{description}</p>
      {note && <p className="-mt-1 mb-2">{note}</p>}
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
      {groups ? (
        groups.map((g) => (
          <div key={g.label} className="mt-4">
            <h3 className="text-base font-bold">{g.label}</h3>
            <FormatButtons endpoint={endpoint} query={`${query}${g.extraQuery}`} buttons={formats} />
          </div>
        ))
      ) : (
        <FormatButtons endpoint={endpoint} query={query} buttons={formats} />
      )}
    </section>
  );
}

/** 日報の PDF（プレビュー・ダウンロード）・CSV。query が null（日付が空）なら押せないボタン。 */
function DailyButtons({ query }: { query: string | null }) {
  return <FormatButtons endpoint="/api/reports/daily" query={query} buttons={DAILY_FORMATS} />;
}

/** 日報：1 日分（日付を選ぶ）と月まとめ（日報のある月を選ぶ。日ごとに改ページ）を PDF（プレビュー・ダウンロード）・CSV で出す。 */
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
