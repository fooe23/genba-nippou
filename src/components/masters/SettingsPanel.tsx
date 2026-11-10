'use client';

import { useState, type FormEvent } from 'react';
import type { Settings } from '@/lib/db/settings';
import { updateSettings } from '@/lib/db/settings-actions';
import { firstError } from '@/lib/db/masters-schemas';
import { settingsInputSchema, type SettingsInput } from '@/lib/db/settings-schemas';
import { ErrorText, Field, UpdatedText, inputClass, numOrNull, primaryButtonClass, str, useRunner, type Updaters } from './common';

/** 率（0〜1）→ 画面の %（小数1桁）。 */
function toPct(rate: number): number {
  return Math.round(rate * 1000) / 10;
}

/** 件の精算の率の入力欄（name・見出し・Settings['rates'] のキー）。 */
const RATE_FIELDS = [
  { name: 'legalWelfarePct', label: '法定福利費率（%）', key: 'legalWelfareRate', hint: '労務（作業内容の施工金額）に掛けます' },
  { name: 'materialExpensePct', label: '材料経費率（%）', key: 'materialExpenseRate', hint: '材料（仕入の買掛・現金）に掛けます' },
  { name: 'leaseFuelExpensePct', label: 'リース・燃料の経費率（%）', key: 'leaseFuelExpenseRate', hint: 'リース・燃料に掛けます' },
  { name: 'overheadProfitPct', label: '諸経費率・利益含む（%）', key: 'overheadProfitRate', hint: '上の合計に掛けます（外注には掛けません）' },
] as const;

/** 労務の計算設定（人工・残業）と、新しい日報の共通時間の既定、追加分の提案金額の率と自社名。管理者だけが変更できる。 */
export function SettingsPanel({ settings, updaters }: { settings: Settings; updaters: Updaters }) {
  const { pending, error, setError, runResult } = useRunner();
  const [saved, setSaved] = useState(false);
  const r = settings.rule;
  const c = settings.defaultCommon;
  const rates = settings.rates;
  const company = settings.company;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    // 必須の数値は空欄を NaN にして、検証の文言（「…の数値で入力してください」）を出す。
    const required = (key: string) => numOrNull(str(fd, key)) ?? NaN;
    const input: SettingsInput = {
      shoteiHours: required('shoteiHours'),
      fixedOvertimeLimit: required('fixedOvertimeLimit'),
      overtimeMultiplier: required('overtimeMultiplier'),
      overtimeBaseHours: required('overtimeBaseHours'),
      defaultCommonStart: str(fd, 'defaultCommonStart'),
      defaultCommonEnd: str(fd, 'defaultCommonEnd'),
      defaultCommonBreakMin: numOrNull(str(fd, 'defaultCommonBreakMin')),
      defaultCommonGapMin: numOrNull(str(fd, 'defaultCommonGapMin')),
      legalWelfarePct: required('legalWelfarePct'),
      materialExpensePct: required('materialExpensePct'),
      leaseFuelExpensePct: required('leaseFuelExpensePct'),
      overheadProfitPct: required('overheadProfitPct'),
      companyName: str(fd, 'companyName'),
      companyContact: str(fd, 'companyContact'),
      budgetDailyRate: required('budgetDailyRate'),
    };
    const message = firstError(settingsInputSchema, input);
    if (message) {
      setError(message);
      return;
    }
    runResult(
      () => updateSettings(input),
      () => setSaved(true),
    );
  }

  const decimalInput = `${inputClass} tabular-nums`;
  return (
    <div>
      <h2 className="mb-1 text-lg font-bold">労務の計算設定（Excel 雛形 V34 と同じ）</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        人工 ＝ 実働が所定以下なら 実働 ÷ 所定（小数2桁）、所定を超えたら 1.0。残業時間 ＝ 実働 − 固定残業の上限（超えた分だけ）。
        労務費 ＝ 日当 × 人工 ＋ 残業時間 × 残業単価。残業単価は作業員マスターの値、空欄なら 日当 ÷ 基準時間 × 割増率（円未満四捨五入）。
      </p>
      {settings.updatedAt && (
        <div className="-mt-1 mb-3">
          <UpdatedText prefix="最終更新" updatedAt={settings.updatedAt} updatedBy={settings.updatedBy} updaters={updaters} />
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="1人工の基準時間（所定・H）">
            <input name="shoteiHours" type="number" inputMode="decimal" step="any" min={0.5} max={24} defaultValue={r.shoteiHours} className={decimalInput} />
          </Field>
          <Field label="固定残業の上限時間（H）">
            <input name="fixedOvertimeLimit" type="number" inputMode="decimal" step="any" min={0} max={24} defaultValue={r.fixedOvertimeLimit} className={decimalInput} />
          </Field>
          <Field label="残業の割増率（倍）">
            <input name="overtimeMultiplier" type="number" inputMode="decimal" step="any" min={0} max={5} defaultValue={r.overtimeMultiplier} className={decimalInput} />
          </Field>
          <Field label="残業単価の基準時間（H）">
            <input name="overtimeBaseHours" type="number" inputMode="decimal" step="any" min={0.5} max={24} defaultValue={r.overtimeBaseHours} className={decimalInput} />
          </Field>
        </div>

        <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
          <p className="text-sm font-bold">共通時間の既定（新しい日報の初期値）</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            現場ごとの既定（管理 → 現場 → ① 現場情報）が無い現場で使います。空欄にすると、新しい日報の共通時間も空欄で始まります。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始">
              <input name="defaultCommonStart" type="time" defaultValue={c.start ?? ''} className={inputClass} />
            </Field>
            <Field label="終了">
              <input name="defaultCommonEnd" type="time" defaultValue={c.end ?? ''} className={inputClass} />
            </Field>
            <Field label="休憩（分）">
              <input name="defaultCommonBreakMin" type="number" inputMode="numeric" min={0} max={600} step={1} defaultValue={c.breakMin ?? ''} className={decimalInput} />
            </Field>
            <Field label="中抜（分）">
              <input name="defaultCommonGapMin" type="number" inputMode="numeric" min={0} max={600} step={1} defaultValue={c.gapMin ?? ''} className={decimalInput} />
            </Field>
          </div>
        </div>

        <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
          <p className="text-sm font-bold">実行予算</p>
          <Field label="予算の標準日当（円／人工）">
            <input
              name="budgetDailyRate"
              type="number"
              inputMode="numeric"
              step="any"
              min={0}
              max={1000000}
              defaultValue={settings.budgetDailyRate}
              className={decimalInput}
            />
          </Field>
          <p className="text-sm text-gray-600 dark:text-gray-400">実行予算の自社の労務（人工）の単価の初期値。行ごとに書き換えられます</p>
        </div>

        <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
          <p className="text-sm font-bold">件の精算（追加・増・変更の提案額）</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            提案額 ＝（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋ リース・燃料 ×（1＋リース・燃料の経費率））×（1＋諸経費率）＋ 外注
            （円未満切り上げ）。根拠にその件を選んだ行だけを数えます。率は社内だけで、客先用の資料には出ません。会社名は提案書に載せます。
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RATE_FIELDS.map((f) => (
              <Field key={f.name} label={f.label}>
                <input
                  name={f.name}
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  max={100}
                  defaultValue={toPct(rates[f.key])}
                  aria-describedby={`${f.name}-hint`}
                  className={decimalInput}
                />
                <span id={`${f.name}-hint`} className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                  {f.hint}
                </span>
              </Field>
            ))}
          </div>
          <Field label="会社名">
            <input name="companyName" defaultValue={company.name ?? ''} maxLength={100} className={inputClass} />
          </Field>
          <Field label="担当者・連絡先">
            <input name="companyContact" defaultValue={company.contact ?? ''} maxLength={200} className={inputClass} />
          </Field>
        </div>

        <p className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50">
          設定の変更は、この後に保存した日報から効きます。保存済みの日報は、開いて保存し直すと新しい設定で計算されます。
        </p>
        <ErrorText message={error} />
        {saved && !error && (
          <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
            保存しました
          </p>
        )}
        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </form>
    </div>
  );
}
