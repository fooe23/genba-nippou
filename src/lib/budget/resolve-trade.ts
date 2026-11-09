import type { SiteTrade, TradeAlias } from './types';

// 日報の作業内容の行の工種を、実行予算の工種に決める（純関数）。日報の行は書き換えない。
// 順：行の工種の参照（siteTradeId）→ 読み替え表（前後の空白を除いた文字で）→ 工種の名前と完全一致（前後の空白を除く）→ null（予算外）。

/** 読み替え表（日報の工種の文字 → 工種 id）。キーは前後の空白を除いた文字。 */
export function aliasMap(aliases: readonly TradeAlias[]): Map<string, string> {
  return new Map(aliases.map((a) => [a.tradeText.trim(), a.tradeId]));
}

/** 工種の名前 → 工種 id。キーは前後の空白を除いた名前。 */
export function tradesByNameMap(trades: readonly SiteTrade[]): Map<string, string> {
  return new Map(trades.map((t) => [t.name.trim(), t.id]));
}

/** 行の工種を決める。決まらなければ null（予算外）。工種の文字が空なら（参照が無ければ）null。 */
export function resolveTradeId(
  line: { siteTradeId: string | null; trade: string },
  aliases: Map<string, string>,
  tradesByName: Map<string, string>,
): string | null {
  if (line.siteTradeId) return line.siteTradeId;
  const text = line.trade.trim();
  if (text === '') return null;
  return aliases.get(text) ?? tradesByName.get(text) ?? null;
}

export interface UnmappedTradeText {
  /** 日報の工種の文字（前後の空白を除いたもの）。 */
  text: string;
  lineCount: number;
  /** 投入人工の合計（空欄は 0）。 */
  manDays: number;
}

/** 人工の合計の浮動小数の誤差を消す（小数第 3 位まで）。 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * まだ工種に決まらない日報の工種の文字の一覧（読み替え表で割り当てる候補）。空の文字は含めない。
 * 並びは投入人工の多い順 → 行の多い順 → 文字の順。
 */
export function unmappedTradeTexts(
  lines: readonly { siteTradeId: string | null; trade: string; manDays: number | null }[],
  aliases: Map<string, string>,
  tradesByName: Map<string, string>,
): UnmappedTradeText[] {
  const byText = new Map<string, UnmappedTradeText>();
  for (const l of lines) {
    if (resolveTradeId(l, aliases, tradesByName) !== null) continue;
    const text = l.trade.trim();
    if (text === '') continue;
    const cur = byText.get(text) ?? { text, lineCount: 0, manDays: 0 };
    cur.lineCount += 1;
    cur.manDays += typeof l.manDays === 'number' && Number.isFinite(l.manDays) ? l.manDays : 0;
    byText.set(text, cur);
  }
  return [...byText.values()]
    .map((u) => ({ ...u, manDays: round3(u.manDays) }))
    .sort((a, b) => b.manDays - a.manDays || b.lineCount - a.lineCount || a.text.localeCompare(b.text, 'ja'));
}
