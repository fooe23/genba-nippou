'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { yen } from '@/lib/calc/format';
import { budgetLineInputSchema, lineAmount, type BudgetLineInput } from '@/lib/budget/schemas';
import {
  BUDGET_ITEM_LABEL,
  PARTNER_ITEMS,
  SITE_WIDE_ITEMS,
  type BudgetItem,
  type BudgetLine,
  type SiteTrade,
} from '@/lib/budget/types';
import { replaceBudgetLines } from '@/lib/db/budget-actions';
import { ErrorText, inputClass, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';
import { DirtyNote, cardClass, dangerSmallButtonClass, numText, parseNum, rowKey, sectionHeadingClass } from './common';

const OWN = 'own';

interface Row {
  key: string;
  tradeId: string | null;
  /** 'own' か協力会社の id。 */
  performer: string;
  item: BudgetItem;
  note: string;
  qty: string;
  unit: string;
  unitPrice: string;
}

function toRows(lines: BudgetLine[]): Row[] {
  return [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      key: l.id,
      tradeId: l.tradeId,
      performer: l.performer === 'partner' && l.supplierId ? l.supplierId : OWN,
      item: l.item,
      note: l.note,
      qty: numText(l.qty),
      unit: l.unit,
      unitPrice: numText(l.unitPrice),
    }));
}

function toInput(r: Row): BudgetLineInput {
  const partner = r.performer !== OWN;
  return {
    tradeId: r.tradeId,
    performer: partner ? 'partner' : 'own',
    supplierId: partner ? r.performer : null,
    item: r.item,
    note: r.note,
    qty: parseNum(r.qty) ?? Number.NaN,
    unit: r.unit,
    unitPrice: parseNum(r.unitPrice) ?? Number.NaN,
  };
}

function rowAmount(r: Row): number | null {
  const q = parseNum(r.qty);
  const p = parseNum(r.unitPrice);
  if (q === null || p === null || Number.isNaN(q) || Number.isNaN(p)) return null;
  return lineAmount(q, p);
}

interface Group {
  /** 工種の id・null＝現場全体・ORPHAN＝消えた工種（保存の前に付け替える行）。 */
  tradeId: string | null;
  label: string;
}

/** 消えた工種のまとまりの印（工種の id と重ならない）。 */
const ORPHAN = '__orphan__';

/**
 * 実行予算：工種ごとのまとまりの下に施工者（自社・協力会社）の行を何行でも足す・消す。材料・リース・その他は「現場全体」。
 * 保存すると全部の行を replaceBudgetLines で入れ替える（Excel の取り込みと同じ Action）。並びは工種の順・まとまりの中の順。
 */
export function BudgetLinesEditor({
  siteId,
  trades,
  lines,
  partners,
  dailyRate,
  readOnly,
}: {
  siteId: string;
  trades: SiteTrade[];
  lines: BudgetLine[];
  /** 施工者に選べる協力会社（協力会社の印のある会社）。 */
  partners: { id: string; name: string }[];
  /** 自社の労務の単価の初期値（全社の設定「予算の標準日当」）。 */
  dailyRate: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, error, run } = useRunner();
  const [rows, setRows] = useState<Row[]>(() => toRows(lines));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const tradeIds = useMemo(() => new Set(trades.map((t) => t.id)), [trades]);
  /** 行のまとまり：工種が一覧から消えた行は ORPHAN（黙って落とさず、付け替えるまで保存させない）。 */
  const groupOf = (r: Row): string | null => (r.tradeId === null || tradeIds.has(r.tradeId) ? r.tradeId : ORPHAN);
  const hasOrphans = rows.some((r) => groupOf(r) === ORPHAN);
  const groups: Group[] = useMemo(
    () => [
      ...[...trades].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => ({ tradeId: t.id, label: t.name })),
      { tradeId: null, label: '現場全体（材料・リース・その他）' },
      ...(hasOrphans ? [{ tradeId: ORPHAN, label: '（消えた工種）' }] : []),
    ],
    [trades, hasOrphans],
  );
  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);

  function change(next: Row[]) {
    setRows(next);
    setDirty(true);
    setSaved(false);
  }
  function update(key: string, patch: Partial<Row>) {
    change(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function setPerformer(r: Row, performer: string) {
    const partner = performer !== OWN;
    const item: BudgetItem = partner ? (PARTNER_ITEMS.includes(r.item) ? r.item : 'subcontract') : 'labor';
    update(r.key, { performer, item });
  }
  function add(tradeId: string | null) {
    const row: Row =
      tradeId === null
        ? { key: rowKey(), tradeId, performer: OWN, item: 'material', note: '', qty: '1', unit: '式', unitPrice: '' }
        : { key: rowKey(), tradeId, performer: OWN, item: 'labor', note: '', qty: '', unit: '人工', unitPrice: numText(dailyRate) };
    // まとまりの最後の行の後ろに入れる（全体の並びは保存のときに工種の順にそろえる）
    change([...rows, row]);
  }

  function ordered(): Row[] {
    return groups.flatMap((g) => rows.filter((r) => groupOf(r) === g.tradeId));
  }

  function save() {
    if (hasOrphans) {
      setLocalError('「（消えた工種）」の行を、ほかの工種に付け替えるか消してから保存してください');
      return;
    }
    const list = ordered();
    for (const g of groups) {
      const inGroup = list.filter((r) => r.tradeId === g.tradeId);
      for (let i = 0; i < inGroup.length; i++) {
        const res = budgetLineInputSchema.safeParse(toInput(inGroup[i]));
        if (!res.success) {
          setLocalError(`${g.tradeId === null ? '現場全体' : `工種「${g.label}」`}の${i + 1}行目：${res.error.issues[0]?.message ?? '入力が正しくありません'}`);
          return;
        }
      }
    }
    setLocalError(null);
    run(
      () => replaceBudgetLines(siteId, list.map(toInput)),
      () => {
        setRows(list);
        setDirty(false);
        setSaved(true);
        router.refresh();
      },
    );
  }

  const total = rows.reduce((s, r) => s + (rowAmount(r) ?? 0), 0);

  return (
    <section aria-labelledby="budget-lines" className="space-y-3">
      <h2 id="budget-lines" className={sectionHeadingClass}>
        実行予算
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        工種ごとに、自社の労務（人工 × 日当）と協力会社の請負・常用を行で入れます。協力会社が 2 社・3 社でも行を足すだけです。材料・リース・その他は工種に分けず「現場全体」に入れます。金額は数量 × 単価（1 円未満は四捨五入）。
      </p>
      {trades.length === 0 && (
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">先に上の「工種」を足して保存すると、工種ごとの行を入れられます。</p>
      )}
      {groups.map((g) => {
        const orphan = g.tradeId === ORPHAN;
        const inGroup = rows.filter((r) => groupOf(r) === g.tradeId);
        const subtotal = inGroup.reduce((s, r) => s + (rowAmount(r) ?? 0), 0);
        return (
          <div
            key={g.tradeId ?? 'site'}
            className={`space-y-2 rounded-lg border-2 p-2 ${orphan ? 'border-amber-600 dark:border-amber-400' : 'border-gray-300 dark:border-gray-700'}`}
          >
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h3 className="min-w-0 text-base font-bold">{g.label}</h3>
              <span className="shrink-0 text-sm tabular-nums">{yen(subtotal)}</span>
            </div>
            {orphan && (
              <p role="status" className="px-1 text-sm font-medium text-amber-800 dark:text-amber-300">
                工種を消したため、どの工種にも入っていない行です。保存の前に、下の「工種」でほかの工種に付け替えるか、行を消してください。
              </p>
            )}
            {inGroup.map((r, i) => {
              const siteWide = SITE_WIDE_ITEMS.includes(r.item);
              const partner = r.performer !== OWN;
              const amount = rowAmount(r);
              const itemChoices: BudgetItem[] = siteWide ? [...SITE_WIDE_ITEMS] : partner ? [...PARTNER_ITEMS] : ['labor'];
              const label = `${g.tradeId === null ? '現場全体' : g.label}の${i + 1}行目`;
              return (
                <div key={r.key} className={`${cardClass} space-y-2`}>
                  {orphan && (
                    <select
                      aria-label={`${label}の工種`}
                      value=""
                      disabled={readOnly || pending}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') return;
                        const tradeId = v === 'site' ? null : v;
                        // 現場全体に移すのは材料・リース・その他だけ（労務などは工種の中に）
                        update(r.key, tradeId === null && !SITE_WIDE_ITEMS.includes(r.item) ? { tradeId, performer: OWN, item: 'material' } : { tradeId });
                      }}
                      className={inputClass}
                    >
                      <option value="">工種を選んで付け替える</option>
                      {groups
                        .filter((x) => x.tradeId !== ORPHAN)
                        .map((x) => (
                          <option key={x.tradeId ?? 'site'} value={x.tradeId ?? 'site'}>
                            {x.tradeId === null ? '現場全体' : x.label}
                          </option>
                        ))}
                    </select>
                  )}
                  <div className="flex gap-2">
                    {!siteWide && (
                      <select
                        aria-label={`${label}の施工者`}
                        value={r.performer}
                        disabled={readOnly || pending}
                        onChange={(e) => setPerformer(r, e.target.value)}
                        className={`${inputClass} min-w-0 flex-1`}
                      >
                        <option value={OWN}>自社</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                        {partner && !partnerName.has(r.performer) && <option value={r.performer}>（協力会社でない会社）</option>}
                      </select>
                    )}
                    <select
                      aria-label={`${label}の項目`}
                      value={r.item}
                      disabled={readOnly || pending || itemChoices.length === 1}
                      onChange={(e) => update(r.key, { item: e.target.value as BudgetItem })}
                      className={`${inputClass} ${siteWide ? 'min-w-0 flex-1' : 'w-28 shrink-0'}`}
                    >
                      {itemChoices.map((it) => (
                        <option key={it} value={it}>
                          {BUDGET_ITEM_LABEL[it]}
                        </option>
                      ))}
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
                    aria-label={`${label}の内容・メモ`}
                    placeholder="内容・メモ"
                    value={r.note}
                    maxLength={200}
                    disabled={readOnly || pending}
                    onChange={(e) => update(r.key, { note: e.target.value })}
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
                </div>
              );
            })}
            {!readOnly && !orphan && (
              <button type="button" onClick={() => add(g.tradeId)} disabled={pending} className={`${secondaryButtonClass} w-full`}>
                ＋ {g.tradeId === null ? '現場全体の行' : `「${g.label}」に行`}を足す
              </button>
            )}
          </div>
        );
      })}
      <p className="text-right text-base font-bold tabular-nums">実行予算の合計 {yen(total)}</p>
      {!readOnly && (
        <button type="button" onClick={save} disabled={pending || !dirty} className={`${primaryButtonClass} w-full`}>
          {pending ? '保存中…' : '実行予算を保存'}
        </button>
      )}
      <DirtyNote dirty={dirty} />
      {saved && (
        <p role="status" className="text-sm font-medium text-green-800 dark:text-green-300">
          実行予算を保存しました。
        </p>
      )}
      <ErrorText message={localError ?? error} />
    </section>
  );
}
