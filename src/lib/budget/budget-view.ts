import { yen } from '@/lib/calc/format';
import type { AttendanceRow, PerformerRow, TradeRow } from '@/lib/budget/budget-model';

// 予算と実績の画面の表示用の純関数（DB・React に依存しない）。

/** 進み具合の上書きの履歴の 1 行（percent が null＝上書きを外した）。 */
export interface ProgressHistoryEntry {
  percent: number | null;
  setBy: string | null;
  /** 入れた人の氏名（読めなければ空）。 */
  setByName: string;
  setAt: string;
}

/** 円。null は「—」。負は「−¥1,234」（見本どおり全角のマイナス記号）。 */
export function yenText(n: number | null): string {
  if (n === null) return '—';
  const s = yen(n);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

/** 人工（小数 1〜2 桁。例 73.0・129.7・0.25）。 */
export function manDaysText(n: number): string {
  return `${n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} 人工`;
}

/** %（10 以上は整数、10 未満は小数 1 桁まで）。null は「—」。 */
export function percentText(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return '—';
  const v = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${v}%`;
}

/** 進み具合の棒：青の幅（使っている %）と赤い線の位置（数量から。100 超は右端）、0〜100。 */
export function progressBar(progress: TradeRow['progress']): { used: number | null; qtyMark: number | null; overQty: boolean } {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return {
    used: progress.used === null ? null : clamp(progress.used),
    qtyMark: progress.fromQty === null ? null : clamp(progress.fromQty),
    overQty: progress.fromQty !== null && progress.fromQty > 100,
  };
}

export type TagTone = 'ok' | 'warn' | 'ng' | 'none';

/** 札の色（文字・背景・枠。濃い色の画面でも読める組み合わせ）。 */
export const TAG_TONE_CLASS: Record<TagTone, string> = {
  ok: 'border-green-400 bg-green-100 text-green-900 dark:border-green-700 dark:bg-green-950 dark:text-green-100',
  warn: 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
  ng: 'border-red-400 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100',
  none: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
};

/** 判定の札（順調／予算超え／赤字の見込み／—）。 */
export function statusTag(status: TradeRow['status']): { label: string; tone: TagTone } {
  switch (status) {
    case 'ok':
      return { label: '順調', tone: 'ok' };
    case 'overBudget':
      return { label: '予算超え', tone: 'warn' };
    case 'loss':
      return { label: '赤字の見込み', tone: 'ng' };
    default:
      return { label: '—', tone: 'none' };
  }
}

/** 判定の札に添える注記：内訳の識別がまだの工種（見込みはあるが内訳の金額と比べられない）は「内訳の識別がまだです」。 */
export function statusNote(t: Pick<TradeRow, 'status' | 'forecast' | 'contractItemCount'>): string | null {
  return t.status === 'none' && t.forecast !== null && t.contractItemCount === 0 ? '内訳の識別がまだです' : null;
}

/** 予算外の作業の札（実績があれば「追加の請求を検討」）。 */
export function outsideTag(amount: number): { label: string; tone: TagTone } | null {
  return amount > 0 ? { label: '追加の請求を検討', tone: 'warn' } : null;
}

/** 粗利の色（負は赤、0 以上は緑、null は色なし）。 */
export function profitClass(n: number | null): string {
  if (n === null) return '';
  return n < 0 ? 'font-bold text-red-700 dark:text-red-400' : 'font-bold text-green-700 dark:text-green-400';
}

/** 実行予算の人工の内わけ（例「自社 80 人工・△△工業 10 人工」）。人工の行が無ければ空。 */
export function budgetManDaysSummary(performers: PerformerRow[]): string {
  return performers
    .filter((p) => p.budgetManDays !== null && p.budgetManDays !== 0)
    .map((p) => `${p.name} ${manDaysText(p.budgetManDays as number)}`)
    .join('・');
}

/** 施工者の行の見出し（「東北建興・請負」「自社・労務」「東北建興・常用（請負外）」「△△工業・常用」）。 */
export function performerLabel(p: Pick<PerformerRow, 'item' | 'name' | 'outsideContract'>): string {
  if (p.item === 'subcontract') return `${p.name}・請負`;
  if (p.item === 'labor') return `${p.name}・労務`;
  return p.outsideContract ? `${p.name}・常用（請負外）` : `${p.name}・常用`;
}

/**
 * 請負の札：件なしの支払いが請負額を超えた → 「請負額を超えています」、請負額の無い会社への外注 →
 * 「実行予算に請負額がありません」。それ以外は null。
 */
export function subcontractTag(p: { budgetAmount: number; overContract: boolean }): { label: string; tone: TagTone } | null {
  if (!p.overContract) return null;
  return p.budgetAmount === 0 ? { label: '実行予算に請負額がありません', tone: 'warn' } : { label: '請負額を超えています', tone: 'ng' };
}

/** 工種の請負の札（請負の行のどれかが超えていれば）。 */
export function tradeSubcontractTag(t: Pick<TradeRow, 'budget'>): { label: string; tone: TagTone } | null {
  const tags = t.budget.byPerformer.filter((p) => p.item === 'subcontract').map(subcontractTag);
  return tags.find((x) => x?.tone === 'ng') ?? tags.find((x) => x !== null) ?? null;
}

/** 施工者の行の見込みの注記（請負は「請負額」か「支払い」、労務・常用は「実績 ÷ 進み具合」）。 */
export function performerForecastNote(p: PerformerRow): string {
  if (p.item !== 'subcontract') return '実績 ÷ 進み具合';
  const base = p.overContract ? '支払い' : '請負額';
  return p.issuePaid !== 0 ? `${base}＋追加の発注` : base;
}

const plainManDays = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** 出面の 1 行（例「出面：東北建興 2.0 人工（うち請負 1.5・常用 0.5）　自社 1.5 人工」）。出面が無ければ空。 */
export function attendanceText(rows: AttendanceRow[]): string {
  if (rows.length === 0) return '';
  const parts = rows.map((a) =>
    a.ukeoiManDays !== 0
      ? `${a.name} ${manDaysText(a.manDays)}（うち請負 ${plainManDays(a.ukeoiManDays)}・常用 ${plainManDays(a.jouyouManDays)}）`
      : `${a.name} ${manDaysText(a.manDays)}`,
  );
  return `出面：${parts.join('　')}`;
}

/** 予算と実績を見られるか（社員・管理者。協力会社は画面を notFound に）。DB の gn_is_employee_or_admin() と同じ。 */
export function canViewBudget(profile: { isAdmin: boolean; accountType: 'employee' | 'partner' }): boolean {
  return profile.isAdmin || profile.accountType === 'employee';
}

/**
 * 進み具合の % を上書きできるか：管理者、またはその現場の確認・承認の人（gn_site_role が reviewer・approver）で社員。
 * 協力会社は役割があっても不可。DB の RLS と同じ判定（RLS が正。ここは画面に入力欄を出すかどうか）。
 */
export function canOverrideProgress(
  profile: { isAdmin: boolean; accountType: 'employee' | 'partner' },
  siteRole: 'staff' | 'reviewer' | 'approver' | null,
): boolean {
  if (profile.isAdmin) return true;
  if (profile.accountType !== 'employee') return false;
  return siteRole === 'reviewer' || siteRole === 'approver';
}

/**
 * % の入力の文字 → 0〜100 の数（小数 1 桁まで）。全角・「%」・空白可。整えた後は「数字」か「数字.数字 1 桁」だけ
 * （"1e2"・"0x10"・"+5"・".5"・"5." などは断る）。
 */
export function parsePercentInput(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.normalize('NFKC').replace(/[%\s]/g, '');
  const msg = '進み具合は 0〜100 の数で入れてください';
  if (/^\d+\.\d{2,}$/.test(t)) return { ok: false, error: '進み具合の小数は 1 桁までにしてください' };
  if (!/^\d+(\.\d)?$/.test(t)) return { ok: false, error: msg };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: msg };
  return { ok: true, value: n };
}
