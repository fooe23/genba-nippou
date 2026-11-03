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

/** 出力画面：月を選び、原本 Excel（.xlsm）をダウンロードする。工事原価集計表・日報は後の Task で入れる。 */
export function ExportPanel({ siteId, months }: { siteId: string; months: ExportMonthOption[] }) {
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

      <Placeholder title="工事原価集計表" />
      <Placeholder title="日報" />
    </div>
  );
}

/** 後の Task で入れる出力の置き場。 */
function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      <button type="button" disabled className={`${secondaryButtonClass} w-full`}>
        準備中
      </button>
    </section>
  );
}
