import { laborLineValues } from '@/lib/calc/report';
import { hasWorkContent } from '@/lib/report/contract-work';
import type { ChangeKind, LaborRule, ReportLine, TimeSpec } from '@/lib/types';

// 契約内の作業の投入人工の自動の割り振り（2026-11-11 利用者の了承）。
// 契約内（区分 契約内・件を選んでいない）の作業内容の行で投入人工が空の行に、その日の出面の人工の合計（名前なしの行は人数分）から
// ほかの作業内容の行（件の行を含む）に入れた投入人工を引いた残りを、等分して入れる（0.01 人工単位。端数は最初の行。残りが 0 以下なら 0）。
// 画面は空のまま「自動 0.5」と薄く見せ、保存のときにサーバーが同じ計算で man_days に書く（画面から届いた値は使わない。
// 保存後は入力した値と同じ扱い：歩掛・実行予算の振り分け・集計・PDF はそのまま動く）。件の行は自動で入れない。

/** 割り振りで見る作業内容の行の項目。 */
export interface AutoManDaysLine {
  changeKind: ChangeKind;
  description: string;
  manDays: number | null;
  qty: number | null;
  unitPrice: number | null;
  issueId: string | null;
}

function entered(manDays: number | null): manDays is number {
  return manDays !== null && Number.isFinite(manDays);
}

/** 自動で投入人工を入れる行か：契約内・件なし・投入人工が空で、中身（施工内容・施工数量・金額）のある行。 */
export function isAutoManDaysTarget(l: AutoManDaysLine): boolean {
  if (l.changeKind !== 'contract' || l.issueId || entered(l.manDays)) return false;
  return hasWorkContent({ ...l, manDays: null }) || (l.qty !== null && Number.isFinite(l.qty) && l.qty !== 0);
}

/**
 * 行ごとの自動の投入人工（対象でない行は null）。laborManDays は作業員の行ごとの人工（人工が 0 より大きい行だけ数える）。
 * 作業員の人工が無い日は割り振らない（全部 null）。
 */
export function autoManDays(laborManDays: readonly number[], lines: readonly AutoManDaysLine[]): (number | null)[] {
  const targets = lines.map(isAutoManDaysTarget);
  const count = targets.filter(Boolean).length;
  const workers = laborManDays.filter((d) => Number.isFinite(d) && d > 0).reduce((s, d) => s + d, 0);
  if (count === 0 || workers <= 0) return lines.map(() => null);
  const others = lines.reduce((s, l, i) => (!targets[i] && entered(l.manDays) ? s + l.manDays : s), 0);
  // 0.01 人工の整数で割る（浮動小数の誤差を落とす）。
  const remaining = Math.max(0, Math.round((workers - others) * 100));
  const base = Math.floor(remaining / count);
  let extra = remaining - base * count;
  return targets.map((t) => {
    if (!t) return null;
    const v = base + extra;
    extra = 0;
    return v / 100;
  });
}

/** 自動の投入人工を入れた行（対象でない行はそのまま）。 */
export function withAutoManDays<L extends AutoManDaysLine>(laborManDays: readonly number[], lines: readonly L[]): L[] {
  const auto = autoManDays(laborManDays, lines);
  return lines.map((l, i) => (auto[i] === null ? l : { ...l, manDays: auto[i] }));
}

/** 割り振りに使う作業員の行ごとの人工：作業員を選んだ（名前のある）行と名前なしの行だけ（日報の画面のずれの知らせと同じ）。 */
export function laborManDaysForAllocation(lines: readonly ReportLine[], common: TimeSpec, rule: LaborRule): number[] {
  return lines.flatMap((l) =>
    l.kind === 'labor' && (l.workerId !== null || l.workerName.trim() !== '') ? [laborLineValues(l, common, rule).manDays] : [],
  );
}

/** 保存の前に、契約内の作業内容の空の投入人工を自動の値で埋める（サーバーの保存で使う）。 */
export function fillAutoManDays(lines: readonly ReportLine[], common: TimeSpec, rule: LaborRule): ReportLine[] {
  const work = lines.flatMap((l) => (l.kind === 'work' ? [l] : []));
  const auto = autoManDays(laborManDaysForAllocation(lines, common, rule), work);
  let i = 0;
  return lines.map((l) => {
    if (l.kind !== 'work') return l;
    const v = auto[i++];
    return v === null ? l : { ...l, manDays: v };
  });
}
