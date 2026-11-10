'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { yen } from '@/lib/calc/format';
import { contractItemInputSchema, lineAmount, type ContractItemInput } from '@/lib/budget/schemas';
import {
  CONTRACT_SECTIONS,
  CONTRACT_SECTION_LABEL,
  type ContractCategory,
  type ContractItem,
  type ContractSection,
  type SiteTrade,
} from '@/lib/budget/types';
import { replaceContractItems } from '@/lib/db/budget-actions';
import { EmptyText, ErrorText, inputClass, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';
import { DirtyNote, useResetOnChange, cardClass, dangerSmallButtonClass, numText, parseNum, rowKey, sectionHeadingClass } from './common';

/** 識別の選択の値：'' ＝まだ識別していない、'expense'・'reduction'、それ以外は工種の id。 */
const EXPENSE = 'expense';
const REDUCTION = 'reduction';

interface Row {
  key: string;
  section: ContractSection;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  unitPrice: string;
  tag: string;
}

function toRows(items: ContractItem[]): Row[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({
      key: i.id,
      section: i.section,
      name: i.name,
      spec: i.spec,
      qty: numText(i.qty),
      unit: i.unit,
      unitPrice: numText(i.unitPrice),
      tag: i.category === 'expense' ? EXPENSE : i.category === 'reduction' ? REDUCTION : (i.tradeId ?? ''),
    }));
}

function toInput(r: Row): ContractItemInput {
  const category: ContractCategory = r.tag === EXPENSE ? 'expense' : r.tag === REDUCTION ? 'reduction' : 'trade';
  return {
    section: r.section,
    name: r.name,
    spec: r.spec,
    qty: parseNum(r.qty) ?? Number.NaN,
    unit: r.unit,
    unitPrice: parseNum(r.unitPrice) ?? Number.NaN,
    category,
    tradeId: category === 'trade' && r.tag !== '' ? r.tag : null,
  };
}

function rowAmount(r: Row): number | null {
  const q = parseNum(r.qty);
  const p = parseNum(r.unitPrice);
  if (q === null || p === null || Number.isNaN(q) || Number.isNaN(p)) return null;
  return lineAmount(q, p);
}

/**
 * 元請けの内訳：行（区分・名称・規格・数量・単位・単価・金額・工種（識別））を足す・消す・直す。
 * 保存すると全部の行を replaceContractItems（全部入れ替える）で入れる（Excel の取り込みと同じ Action）。
 * 「経費」「減分」は工種に入れず、内訳の金額の合計にだけ数える。
 */
export function ContractItemsEditor({
  siteId,
  trades,
  items,
  readOnly,
}: {
  siteId: string;
  trades: SiteTrade[];
  items: ContractItem[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, error, run } = useRunner();
  const [rows, setRows] = useState<Row[]>(() => toRows(items));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useResetOnChange(items.map((i) => i.id).join('|'), () => {
    setRows(toRows(items));
    setDirty(false);
    setLocalError(null);
  });
  const sortedTrades = [...trades].sort((a, b) => a.sortOrder - b.sortOrder);
  const tradeIds = new Set(trades.map((t) => t.id));
  /** 工種が一覧から消えた行は「未識別」として扱う（画面にも保存にも、消えた工種の id を残さない）。 */
  const tagOf = (r: Row): string => (r.tag === '' || r.tag === EXPENSE || r.tag === REDUCTION || tradeIds.has(r.tag) ? r.tag : '');

  function change(next: Row[]) {
    setRows(next);
    setDirty(true);
    setSaved(false);
  }
  function update(key: string, patch: Partial<Row>) {
    change(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function add() {
    const last = rows[rows.length - 1];
    change([...rows, { key: rowKey(), section: last?.section ?? 'initial', name: '', spec: '', qty: '', unit: '', unitPrice: '', tag: '' }]);
  }

  function save() {
    for (let i = 0; i < rows.length; i++) {
      const res = contractItemInputSchema.safeParse(toInput({ ...rows[i], tag: tagOf(rows[i]) }));
      if (!res.success) {
        setLocalError(`元請けの内訳の${i + 1}行目：${res.error.issues[0]?.message ?? '入力が正しくありません'}`);
        return;
      }
    }
    setLocalError(null);
    run(
      () => replaceContractItems(siteId, rows.map((r) => toInput({ ...r, tag: tagOf(r) })), 'replace'),
      () => {
        setDirty(false);
        setSaved(true);
        router.refresh();
      },
    );
  }

  const total = rows.reduce((s, r) => s + (rowAmount(r) ?? 0), 0);
  const untagged = rows.filter((r) => tagOf(r) === '').length;

  return (
    <section aria-labelledby="contract-items" className="space-y-3">
      <h2 id="contract-items" className={sectionHeadingClass}>
        元請けの内訳（{rows.length}行）
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        元請けから届いた内訳（注文書）の行です。右端の「工種（識別）」で、どの工種の分かを選びます。「経費」「減分」は工種に入れず、内訳の金額の合計にだけ数えます。変更の内訳が届いたら、区分を「変更」にして行を足します。
      </p>
      {rows.length === 0 ? (
        <EmptyText>元請けの内訳はまだありません。</EmptyText>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const label = `内訳の${i + 1}行目`;
            const amount = rowAmount(r);
            return (
              <li key={r.key} className={`${cardClass} space-y-2`}>
                <div className="flex gap-2">
                  <select
                    aria-label={`${label}の区分`}
                    value={r.section}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { section: e.target.value as ContractSection })}
                    className={`${inputClass} w-24 shrink-0`}
                  >
                    {CONTRACT_SECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {CONTRACT_SECTION_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`${label}の工種（識別）`}
                    value={tagOf(r)}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { tag: e.target.value })}
                    className={`${inputClass} min-w-0 flex-1 ${tagOf(r) === '' ? 'border-amber-600 dark:border-amber-400' : ''}`}
                  >
                    <option value="">（工種を選ぶ）</option>
                    {sortedTrades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    <option value={EXPENSE}>経費</option>
                    <option value={REDUCTION}>減分</option>
                  </select>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`${label}を消す`}
                      onClick={() => change(rows.filter((x) => x.key !== r.key))}
                      disabled={pending}
                      className={dangerSmallButtonClass}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <input
                  aria-label={`${label}の名称`}
                  placeholder="名称"
                  value={r.name}
                  maxLength={200}
                  disabled={readOnly || pending}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className={inputClass}
                />
                <input
                  aria-label={`${label}の規格・仕様`}
                  placeholder="規格・仕様"
                  value={r.spec}
                  maxLength={200}
                  disabled={readOnly || pending}
                  onChange={(e) => update(r.key, { spec: e.target.value })}
                  className={inputClass}
                />
                <div className="grid grid-cols-[1fr_4.5rem_1fr] gap-2">
                  <input
                    aria-label={`${label}の数量`}
                    placeholder="数量"
                    inputMode="decimal"
                    value={r.qty}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { qty: e.target.value })}
                    className={`${inputClass} text-right`}
                  />
                  <input
                    aria-label={`${label}の単位`}
                    placeholder="単位"
                    value={r.unit}
                    maxLength={20}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { unit: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`${label}の単価`}
                    placeholder="単価"
                    inputMode="decimal"
                    value={r.unitPrice}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                    className={`${inputClass} text-right`}
                  />
                </div>
                <p className="text-right text-sm tabular-nums">金額 {amount === null ? '—' : yen(amount)}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-right text-base font-bold tabular-nums">内訳の金額の合計 {yen(total)}</p>
      {untagged > 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-300">工種（識別）をまだ選んでいない行が {untagged} 行あります（予算と実績の比べ方に入りません）。</p>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={add} disabled={pending} className={secondaryButtonClass}>
            ＋ 行を足す
          </button>
          <button type="button" onClick={save} disabled={pending || !dirty} className={`${primaryButtonClass} sm:flex-1`}>
            {pending ? '保存中…' : '元請けの内訳を保存'}
          </button>
        </div>
      )}
      <DirtyNote dirty={dirty} />
      {saved && (
        <p role="status" className="text-sm font-medium text-green-800 dark:text-green-300">
          元請けの内訳を保存しました。
        </p>
      )}
      <ErrorText message={localError ?? error} />
    </section>
  );
}
