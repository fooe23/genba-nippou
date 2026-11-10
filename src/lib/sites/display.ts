import { yen } from '@/lib/calc/format';

// 現場（＝1 つの工事）の一覧・見出しの表示。同じ建物に工事が複数あっても見分けられるよう、工事名を先に出す。
// 純粋関数（server-only を読まない）。帳票（PDF・Excel）と日報の画面はこれを使わない。

/** 表示に使う項目だけ（Site の一部）。 */
export interface SiteDisplayFields {
  name: string;
  projectName: string | null;
  clientName: string | null;
  contractAmount: number | null;
}

/** お金の項目（協力会社のアカウントには渡さない）。 */
export interface SiteMoneyFields {
  contractAmount: number | null;
  estimatedAmount: number | null;
  defaultDailyRate: number | null;
}

function trimmed(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/** 見出し：「工事名 ／ 現場名」。工事名が空なら現場名だけ。 */
export function siteTitle(site: Pick<SiteDisplayFields, 'name' | 'projectName'>): string {
  const project = trimmed(site.projectName);
  const name = trimmed(site.name) || site.name;
  return project ? `${project} ／ ${name}` : name;
}

/** 請負金額の表示。未入力は「—」（¥0 とは分ける）。 */
export function contractAmountText(amount: number | null): string {
  return amount === null ? '—' : yen(amount);
}

/**
 * 2 行目：「客先：客先名」。showAmount（社員・管理者だけ true）なら「 ｜ 請負金額：¥…」を足す。
 * 客先名が空なら「客先：—」。協力会社には showAmount を false にして、金額の文字も出さない。
 */
export function siteSubline(site: Pick<SiteDisplayFields, 'clientName' | 'contractAmount'>, opts: { showAmount: boolean }): string {
  const client = `客先：${trimmed(site.clientName) || '—'}`;
  return opts.showAmount ? `${client} ｜ 請負金額：${contractAmountText(site.contractAmount)}` : client;
}

/**
 * 見る人に合わせて現場のお金の項目を落とす。showMoney が false（協力会社）なら、
 * 請負金額・概算金額・常用単価の既定を null にした写しを返す（画面の部品や client component に渡す前に使う）。
 */
export function siteForViewer<T extends SiteMoneyFields>(site: T, showMoney: boolean): T {
  if (showMoney) return site;
  return { ...site, contractAmount: null, estimatedAmount: null, defaultDailyRate: null };
}
