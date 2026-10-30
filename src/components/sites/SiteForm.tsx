'use client';

import { useState, type FormEvent } from 'react';
import { firstError } from '@/lib/db/masters-schemas';
import { upsertSite } from '@/lib/db/sites-actions';
import type { Site, SiteInput } from '@/lib/db/sites';
import { CONTRACT_TYPES, SITE_STATUSES, siteInputSchema } from '@/lib/db/sites-schemas';
import { ErrorText, Field, inputClass, numOrNull, primaryButtonClass, str, useRunner } from '@/components/masters/common';
import { STATUS_LABELS } from './labels';

function textOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key).trim();
  return v === '' ? null : v;
}

function isContractType(v: string): v is NonNullable<Site['contractType']> {
  return (CONTRACT_TYPES as readonly string[]).includes(v);
}

/** 現場情報フォーム（雛形の現場情報マスターと同じ並び・ラベル）。新規作成（ダイアログ）と編集で共用。 */
export function SiteForm({
  site,
  onSaved,
}: {
  site: Site | null;
  onSaved?: (id: string) => void;
}) {
  const { pending, error, setError, run } = useRunner();
  const [saved, setSaved] = useState(false);

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
      status: status === 'done' ? 'done' : status === 'active' ? 'active' : undefined,
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
