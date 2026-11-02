// updatedBy は更新した人（profiles.id）。表示用で、単価の計算には使わない。
export interface RateHistory { amount: number; effectiveFrom: string; updatedBy?: string | null; }

// effectiveFrom <= date のうち最も新しいものの amount。無ければ null。履歴は並び順を仮定しない。
export function rateAt(history: RateHistory[], date: string): number | null {
  let best: RateHistory | null = null;
  for (const h of history) {
    if (h.effectiveFrom > date) continue;
    if (best === null || h.effectiveFrom > best.effectiveFrom) best = h;
  }
  return best === null ? null : best.amount;
}
