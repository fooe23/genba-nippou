'use client';

import { useState, type FormEvent } from 'react';
import { firstError } from '@/lib/db/masters-schemas';
import { upsertSite } from '@/lib/db/sites-actions';
import type { Site, SiteInput } from '@/lib/db/sites';
import { CONTRACT_STATUSES, CONTRACT_TYPES, SITE_STATUSES, siteInputSchema } from '@/lib/db/sites-schemas';
import { ErrorText, Field, inputClass, numOrNull, primaryButtonClass, str, useRunner } from '@/components/masters/common';
import { CONTRACT_STATUS_LABELS, STATUS_LABELS } from './labels';

function textOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key).trim();
  return v === '' ? null : v;
}

function isContractType(v: string): v is NonNullable<Site['contractType']> {
  return (CONTRACT_TYPES as readonly string[]).includes(v);
}

/**
 * 現場情報フォーム（雛形の現場情報マスターと同じ並び・ラベル）。新規作成（ダイアログ）と編集で共用。
 * 「見積提出が必須のお客様」（2026-11-20）は DB に列があるときだけ出す（編集は site.estimateRequired が null でない、
 * 新規は estimateReady）。管理者の画面だけ（このフォームは管理者だけが使う）。
 */
export function SiteForm({
  site,
  onSaved,
  estimateReady = false,
}: {
  site: Site | null;
  onSaved?: (id: string) => void;
  /** 新規作成のとき、DB に「見積提出が必須」の列があるか。 */
  estimateReady?: boolean;
}) {
  const showEstimateRequired = site ? site.estimateRequired !== null : estimateReady;
  const { pending, error, setError, run } = useRunner();
  const [saved, setSaved] = useState(false);
  // 未確定のときだけ概算金額の欄を出す（確定に戻しても入力値は残し、そのまま保存する）。
  const [contractStatus, setContractStatus] = useState<Site['contractStatus']>(site?.contractStatus ?? 'fixed');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const contractType = str(fd, 'contractType');
    const startDate = str(fd, 'startDate');
    const endDate = str(fd, 'endDate');
    const status = str(fd, 'status');
    const input: SiteInput = {
      id: site?.id,
      name: str(fd, 'name'),
      clientName: textOrNull(fd, 'clientName'),
      projectName: textOrNull(fd, 'projectName'),
      projectNo: textOrNull(fd, 'projectNo'),
      overview: textOrNull(fd, 'overview'),
      contractAmount: numOrNull(str(fd, 'contractAmount')),
      startDate: startDate === '' ? null : startDate,
      endDate: endDate === '' ? null : endDate,
      contractType: isContractType(contractType) ? contractType : null,
      contractStatus,
      estimatedAmount: numOrNull(str(fd, 'estimatedAmount')),
      defaultDailyRate: numOrNull(str(fd, 'defaultDailyRate')),
      status: status === 'done' ? 'done' : status === 'active' ? 'active' : undefined,
      commonStart: textOrNull(fd, 'commonStart'),
      commonEnd: textOrNull(fd, 'commonEnd'),
      commonBreakMin: numOrNull(str(fd, 'commonBreakMin')),
      commonGapMin: numOrNull(str(fd, 'commonGapMin')),
      ...(showEstimateRequired ? { estimateRequired: fd.get('estimateRequired') === 'on' } : {}),
    };
    const message = firstError(siteInputSchema, input);
    if (message) {
      setError(message);
      return;
    }
    let savedId = site?.id ?? '';
    run(
      async () => {
        savedId = await upsertSite(input);
      },
      () => {
        setSaved(true);
        onSaved?.(savedId);
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="現場名（必須）">
        <input name="name" defaultValue={site?.name ?? ''} maxLength={100} className={inputClass} />
      </Field>
      <Field label="客先名（請求先）">
        <input name="clientName" defaultValue={site?.clientName ?? ''} maxLength={200} className={inputClass} />
      </Field>
      <Field label="工事名">
        <input name="projectName" defaultValue={site?.projectName ?? ''} maxLength={200} className={inputClass} />
      </Field>
      <Field label="工事番号">
        <input name="projectNo" defaultValue={site?.projectNo ?? ''} maxLength={200} className={inputClass} />
      </Field>
      <Field label="工事概要">
        <textarea
          name="overview"
          defaultValue={site?.overview ?? ''}
          maxLength={200}
          rows={3}
          className={`${inputClass} py-2`}
        />
      </Field>
      <Field label="工事総請負金額（円）">
        <input
          name="contractAmount"
          type="number"
          inputMode="decimal"
          min={0}
          defaultValue={site?.contractAmount ?? ''}
          className={inputClass}
        />
      </Field>
      <Field label="契約の状態">
        <select
          name="contractStatus"
          value={contractStatus}
          onChange={(e) => setContractStatus(e.target.value === 'tentative' ? 'tentative' : 'fixed')}
          className={inputClass}
        >
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTRACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <div hidden={contractStatus !== 'tentative'}>
        <Field label="概算金額（見積提示額・円）">
          <input
            name="estimatedAmount"
            type="number"
            inputMode="decimal"
            min={0}
            defaultValue={site?.estimatedAmount ?? ''}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="常用単価の既定（客先請求・円／人工）">
        <input
          name="defaultDailyRate"
          type="number"
          inputMode="decimal"
          min={0}
          defaultValue={site?.defaultDailyRate ?? ''}
          className={inputClass}
        />
      </Field>
      {showEstimateRequired && (
        <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
          <label className="flex min-h-11 items-center gap-3 text-base font-medium">
            <input
              name="estimateRequired"
              type="checkbox"
              defaultChecked={site?.estimateRequired === true}
              className="h-6 w-6 shrink-0"
            />
            見積提出が必須のお客様
          </label>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            オンにすると、この現場で新しく作る件の「見積書」が最初から「要（先に出す）」になります（やり直しの件は「不要」）。件ごとに変えられます。
          </p>
        </div>
      )}
      <Field label="着工予定日">
        <input name="startDate" type="date" defaultValue={site?.startDate ?? ''} className={inputClass} />
      </Field>
      <Field label="竣工予定日">
        <input name="endDate" type="date" defaultValue={site?.endDate ?? ''} className={inputClass} />
      </Field>
      <Field label="請負の種類">
        <select name="contractType" defaultValue={site?.contractType ?? ''} className={inputClass}>
          <option value="">未設定</option>
          {CONTRACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="状態">
        <select name="status" defaultValue={site?.status ?? 'active'} className={inputClass}>
          {SITE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <div role="group" aria-label="共通時間の既定（任意）" className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
        <p className="text-sm font-bold">共通時間の既定（任意）</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          空欄なら全社の設定（管理 → マスター → 労務の設定）を使います。新しい日報を開いたときの初期値になります。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始">
            <input name="commonStart" type="time" defaultValue={site?.commonStart ?? ''} className={inputClass} />
          </Field>
          <Field label="終了">
            <input name="commonEnd" type="time" defaultValue={site?.commonEnd ?? ''} className={inputClass} />
          </Field>
          <Field label="休憩（分）">
            <input
              name="commonBreakMin"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              step={1}
              defaultValue={site?.commonBreakMin ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="中抜（分）">
            <input
              name="commonGapMin"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              step={1}
              defaultValue={site?.commonGapMin ?? ''}
              className={inputClass}
            />
          </Field>
        </div>
      </div>
      <ErrorText message={error} />
      {saved && !error && (
        <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
          保存しました
        </p>
      )}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        {pending ? '保存中…' : site ? '保存' : '作成'}
      </button>
    </form>
  );
}
