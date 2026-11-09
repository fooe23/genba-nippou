import { OWN_LABEL, UNKNOWN_PARTNER_LABEL, type SupplierNames } from '@/lib/calc/affiliation';
import { aliasMap, resolveTradeId, tradesByNameMap, unmappedTradeTexts, type UnmappedTradeText } from '@/lib/budget/resolve-trade';
import { PARTNER_ITEMS, SITE_WIDE_ITEMS, type BudgetData, type BudgetLine, type ContractItem } from '@/lib/budget/types';
import type { SavedReportLine } from '@/lib/reports/types';
import type { ChangeKind } from '@/lib/types';

// 予算と実績の集計（純関数。DB・Next に依存しない）。金額・人工はすべて保存値（明細の stored）から計算する。
//
// 実績の労務費・人工の工種への振り分け（日報 1 件＝1 日ごと。設計書「協力会社の人工の工種への振り分け」）：
// - 作業内容の行の工種を resolveTradeId（参照 → 読み替え表 → 工種名 → null）で決める。現場の工種に無い id も null。
// - その日の重み＝工種ごとの作業内容の行の投入人工（stored.manDays）。工種の決まらない行の投入人工も
//   「予算外」の重みとして加わる（例：工種 A 3 人工・決まらない行 1 人工の日 → 自社の労務費の 25% が予算外）。
//   投入人工が空欄の行（現場ではよくある）の重みは、その日の空欄でない作業内容の行（工種の決まった行・決まらない行の両方）の
//   投入人工の平均、その日の行がすべて空欄なら 1（空欄の工種の行が予算外にすべて取られないように）。0 と入れた行は 0。
//   重みがすべて 0 で工種の決まった行があるときは、工種の決まった行 1 行を重み 1 として等分する。
//   日の画面の「投入人工」（workManDays・行の manDays）は入れた値のまま（空欄は 0）。
// - その日に工種の決まった作業内容の行が 1 行も無ければ、その日の労務費・人工は全部「予算外」（協力会社も含む。
//   下の「施工者に入れた工種が 1 つならそこへ全部」より先に効く）。
// - 協力会社（労務の行の所属の写しが 'partner'、会社あり）：実行予算でその会社を施工者（請負・常用）に入れた工種が
//   1 つ → その工種に全部。2 つ以上 → その日の重みのうちそれらの工種の分の比（それらの工種の重みがすべて 0 なら等分）。
//   どこにも入れていない会社（会社の写しが無い協力会社を含む）→ その日の重みの比（予算外を含む）。
// - 自社と所属なし → その日の重みの比（予算外を含む）。施工者の行では所属なしは「自社」の行にまとめる。
// - 労務費は 1 円単位、人工は 0.01 人工単位で比例配分し、端数は重みの最も大きい先（同じなら工種の並びの先、予算外は最後）
//   に足す。分けた和はその日の労務費・人工と一致する（affiliation-breakdown.ts の apportionManDays と同じやり方）。
//
// 現場全体：燃料・リース・現金・掛け（労務・作業内容以外の行）の実績の合計と、実行予算の材料・リース・その他。
// 元請けの内訳：工種の識別が付いた行（category 'trade' かつ tradeId あり）だけ工種の内訳の金額に入る。経費・減分・
// まだ識別していない行は工種に入れず、合計の内訳の金額にだけ数える。
// 実行予算の労務・請負・常用で工種の無い行（現場全体の労務）は「予算外」の行の予算に入れる。
//
// 進み具合（% 表記 0〜100）：
// - 数量から＝日報のその工種の施工数量の合計 ÷ その工種の内訳の行（当初＋変更）の数量の合計 × 100。単位は前後の空白を除き
//   NFKC（全角 → 半角、㎡ → m2）と小文字にして比べ、単位の違う日報の行は数えない。内訳の行の単位が複数あるときは金額の合計の
//   最も大きい単位（同じなら先に出た単位）を使う。分母が 0（内訳の行が無い・数量 0）なら null。その単位で数量を入れた日報の
//   行が 1 行も無ければ（単位が合わない・数量が空）null（「数量から」は出さない。qty も null）。100 を超えても切らない。
// - 上書き＝data.progress（工種ごとの最新の上書き。消した工種は含まれない）。
// - used＝上書き ?? 数量から を 0〜100 に収めたもの。
// 見込み＝実績の金額 ÷ (used / 100)（円に四捨五入）。used が null・0 なら見込み・見込みの粗利は null、判定は 'none'。
// 判定：見込み > 内訳の金額 → 'loss'、そうでなく見込み > 実行予算 → 'overBudget'、それ以外 → 'ok'（実行予算が内訳の金額
// より大きくても、内訳の金額を超える見込みは 'loss'）。ただし工種に識別した内訳の行が 1 行も無い工種（contractItemCount 0）は
// 内訳の金額と比べられないので、'loss' の代わりに 'none'、見込みの粗利は null（画面は「内訳の識別がまだです」と添える）。
// 予算の人工（budgetManDays）：労務・常用の行のうち、単位が「人工」「人」「人日」か空欄の行の数量だけ。
//
// 繰越初期値（gn_carryovers。Excel から途中で移したときの作業員ごとの人工・労務費）：工種が分からないので「予算外」の行の
// carryover に別に出し（予算外の作業の人工・労務費には入れない）、合計の実績に数える。作業員別累計（workerCumulative）・
// 原価集計表と同じく、繰越のある作業員の繰越の基準日より前の労務の行は二重に数えないよう、どこにも入れない。
//
// 協力会社の請負金額（partnerContract）は現場の協力会社（gn_site_partners.amount）の額で、工種に分けない（2 つの工種に
// 入っている会社はどちらの行にも同じ額が出る）。

export interface BudgetModelInput {
  data: BudgetData;
  /** 現場の保存済み日報（日付・保存値つき明細）。順不同可。asOf より後の日報は数えない。 */
  reports: { date: string; lines: SavedReportLine[] }[];
  /** 予算の標準日当（設定。円／人工）。表示用にそのまま返す。 */
  dailyRate: number;
  /** 集計の基準日（YYYY-MM-DD）。この日までの日報を数える。 */
  asOf: string;
  /** 現場の協力会社（gn_site_partners）。amount は請負金額。 */
  sitePartners: { supplierId: string; name: string; amount: number | null }[];
  /** 取引先の名前（施工者の表示名。sitePartners に無い会社のため）。 */
  supplierNames?: SupplierNames;
  /** 繰越初期値（gn_carryovers）。省略は無し。 */
  carryovers?: { workerId: string; manDays: number; laborCost: number; beforeDate: string }[];
}

export interface PerformerRow {
  performer: 'own' | 'partner';
  supplierId: string | null;
  name: string;
  budgetAmount: number;
  /** 労務（自社）・常用（協力会社）の数量（人工）の合計。どちらの行も無ければ null。 */
  budgetManDays: number | null;
  actualAmount: number;
  actualManDays: number;
  partnerContract: number | null;
}

export interface WorkLineDetail {
  /** 日報の工種の文字。 */
  trade: string;
  description: string;
  qty: number | null;
  unit: string;
  /** 投入人工（stored.manDays）。空欄は null（画面は「—」）。 */
  manDays: number | null;
  /** 作業内容の区分（契約内・追加・増・変更・減）。 */
  changeKind: ChangeKind;
}

export interface TradeDay {
  date: string;
  /** 振り分けた人工（労務の行の人工の分）。 */
  manDays: number;
  /** 振り分けた労務費。 */
  amount: number;
  /** その工種の作業内容の行の投入人工の合計。 */
  workManDays: number;
  /** 進み具合の単位の施工数量の合計（その単位の行が無ければ null）。 */
  qty: number | null;
  unit: string | null;
  lines: WorkLineDetail[];
}

export interface TradeRow {
  tradeId: string;
  name: string;
  contractAmount: number;
  /** その工種に識別した元請けの内訳の行の数（0＝内訳の識別がまだ）。 */
  contractItemCount: number;
  budget: { amount: number; manDays: number; byPerformer: PerformerRow[] };
  actual: { amount: number; manDays: number; byPerformer: PerformerRow[]; qty: number | null; unit: string | null };
  progress: { used: number | null; fromQty: number | null; override: number | null };
  forecast: number | null;
  forecastProfit: number | null;
  status: 'ok' | 'overBudget' | 'loss' | 'none';
  days: TradeDay[];
}

/** 工種の付かない人工・労務費（予算外の作業）。 */
export interface OutsideRow {
  /** 実行予算の労務・請負・常用で工種の無い行。 */
  budget: { amount: number; manDays: number };
  amount: number;
  manDays: number;
  byPerformer: PerformerRow[];
  /** 工種の決まらない作業内容の行の数・投入人工。 */
  workLineCount: number;
  workManDays: number;
  days: TradeDay[];
  /** 繰越初期値の合計（工種なし）。繰越が無ければ null。amount・manDays には含めない。 */
  carryover: { manDays: number; amount: number } | null;
}

export interface SiteWideRow {
  budget: { material: number; lease: number; other: number; amount: number };
  actual: { fuel: number; lease: number; cash: number; credit: number; amount: number };
  /** 元請けの内訳の経費の金額。 */
  contractExpense: number;
}

export interface TotalRow {
  /** 元請けの内訳の金額の合計（工種・経費・減分・未識別のすべて）。 */
  contractAmount: number;
  /** うち工種の付いた行。 */
  contractTradeAmount: number;
  contractExpense: number;
  contractReduction: number;
  /** 識別が工種でまだ工種を付けていない行。 */
  contractUnassigned: number;
  /** 実行予算の合計（工種＋予算外＋現場全体）。 */
  budgetAmount: number;
  /** 実績の合計（工種の労務費＋予算外＋繰越初期値＋現場全体）。 */
  actualAmount: number;
  actualManDays: number;
}

export interface BudgetModel {
  asOf: string;
  dailyRate: number;
  trades: TradeRow[];
  outside: OutsideRow;
  siteWide: SiteWideRow;
  total: TotalRow;
}

// ─── 部品 ───

const OUTSIDE = '\u0000outside';

function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** 単位の比較用（前後の空白を除き、NFKC と小文字）。 */
export function normalizeUnit(unit: string): string {
  return unit.trim().normalize('NFKC').toLowerCase();
}

interface Weight {
  key: string;
  w: number;
  /** 並び（同じ重みのとき小さいほうが端数を受ける）。 */
  order: number;
}

/**
 * total を重みの比で分ける。step 単位（円＝1、人工＝0.01）で切り捨て、端数は重みの最も大きい先に足す
 * （その先の値＝total − ほかの和なので、和は total と一致する）。重みの正の先が無ければ空。
 */
export function apportion(total: number, weights: Weight[], step: number): Map<string, number> {
  const out = new Map<string, number>();
  if (total === 0) return out;
  const positive = weights.filter((x) => x.w > 0);
  const W = positive.reduce((s, x) => s + x.w, 0);
  if (W <= 0) return out;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const sorted = [...positive].sort((a, b) => b.w - a.w || a.order - b.order);
  const [largest, ...others] = sorted;
  let sum = 0;
  for (const x of others) {
    const part = round9(Math.floor((abs * x.w) / W / step + 1e-9) * step);
    sum += part;
    if (part !== 0) out.set(x.key, sign * part);
  }
  const rest = round9(abs - sum);
  if (rest !== 0) out.set(largest.key, sign * rest);
  return out;
}

function addTo(map: Map<string, number>, key: string, v: number) {
  map.set(key, (map.get(key) ?? 0) + v);
}

interface Acc {
  amount: number;
  manDays: number;
}

interface DayAcc {
  date: string;
  manDays: number;
  amount: number;
  workManDays: number;
  qty: number | null;
  lines: WorkLineDetail[];
}

/** 作業内容の行の投入人工が空欄か。 */
function isBlankManDays(v: number | null): boolean {
  return v === null || !Number.isFinite(v);
}

const MAN_DAY_UNITS = new Set(['人工', '人', '人日', '']);
/** 予算の行の数量を人工として数えるか（労務・常用で単位が人工・人・人日・空欄）。 */
function countsAsManDays(b: BudgetLine): boolean {
  return (b.item === 'labor' || b.item === 'jouyou') && MAN_DAY_UNITS.has(normalizeUnit(b.unit));
}

function performerKey(supplierId: string | null): string {
  return supplierId === null ? 'own' : `partner:${supplierId}`;
}

// ─── 本体 ───

export function buildBudgetModel(input: BudgetModelInput): BudgetModel {
  const { data } = input;
  const tradeIds = new Set(data.trades.map((t) => t.id));
  const tradeOrder = new Map([...data.trades].sort((a, b) => a.sortOrder - b.sortOrder).map((t, i) => [t.id, i]));
  const orderedTrades = [...data.trades].sort((a, b) => a.sortOrder - b.sortOrder);
  const aliases = aliasMap(data.aliases);
  const byName = tradesByNameMap(data.trades);
  const resolve = (l: { siteTradeId: string | null; trade: string }): string | null => {
    const id = resolveTradeId(l, aliases, byName);
    return id !== null && tradeIds.has(id) ? id : null;
  };
  const orderOf = (key: string) => (key === OUTSIDE ? Number.MAX_SAFE_INTEGER : (tradeOrder.get(key) ?? Number.MAX_SAFE_INTEGER - 1));

  // 協力会社 → 施工者に入れた工種（請負・常用の行）
  const supplierTrades = new Map<string, string[]>();
  for (const b of data.budgetLines) {
    if (!PARTNER_ITEMS.includes(b.item) || !b.supplierId || !b.tradeId || !tradeIds.has(b.tradeId)) continue;
    const list = supplierTrades.get(b.supplierId) ?? [];
    if (!list.includes(b.tradeId)) list.push(b.tradeId);
    supplierTrades.set(b.supplierId, list);
  }

  // 工種ごとの内訳の行と、進み具合の単位
  const contractByTrade = new Map<string, ContractItem[]>();
  for (const c of data.contractItems) {
    if (c.category !== 'trade' || !c.tradeId || !tradeIds.has(c.tradeId)) continue;
    const list = contractByTrade.get(c.tradeId) ?? [];
    list.push(c);
    contractByTrade.set(c.tradeId, list);
  }
  const progressUnit = new Map<string, { unit: string; label: string; denominator: number }>();
  for (const [tradeId, items] of contractByTrade) {
    const byUnit = new Map<string, { label: string; amount: number; qty: number }>();
    for (const c of items) {
      const key = normalizeUnit(c.unit);
      const cur = byUnit.get(key) ?? { label: c.unit.trim(), amount: 0, qty: 0 };
      cur.amount += c.amount;
      cur.qty += c.qty;
      byUnit.set(key, cur);
    }
    let best: [string, { label: string; amount: number; qty: number }] | null = null;
    for (const entry of byUnit) if (best === null || entry[1].amount > best[1].amount) best = entry;
    if (best) progressUnit.set(tradeId, { unit: best[0], label: best[1].label, denominator: round9(best[1].qty) });
  }

  // 実績の積み上げ
  const tradeActual = new Map<string, Map<string, Acc>>(); // 工種（または OUTSIDE）→ 施工者 → 金額・人工
  const days = new Map<string, Map<string, DayAcc>>(); // 工種（または OUTSIDE）→ 日付 → 日の行
  const tradeQty = new Map<string, number>(); // 進み具合の単位の施工数量
  const qtyMatched = new Set<string>(); // 進み具合の単位で数量を入れた行のある工種
  const siteActual = { fuel: 0, lease: 0, cash: 0, credit: 0 };
  let outsideWorkLineCount = 0;
  let outsideWorkManDays = 0;

  const dayOf = (bucket: string, date: string): DayAcc => {
    let m = days.get(bucket);
    if (!m) days.set(bucket, (m = new Map()));
    let d = m.get(date);
    if (!d) m.set(date, (d = { date, manDays: 0, amount: 0, workManDays: 0, qty: null, lines: [] }));
    return d;
  };
  const addActual = (bucket: string, perf: string, amount: number, manDays: number) => {
    let m = tradeActual.get(bucket);
    if (!m) tradeActual.set(bucket, (m = new Map()));
    const cur = m.get(perf) ?? { amount: 0, manDays: 0 };
    cur.amount += amount;
    cur.manDays += manDays;
    m.set(perf, cur);
  };

  const carryovers = input.carryovers ?? [];
  const beforeDates = new Map(carryovers.map((c) => [c.workerId, c.beforeDate]));
  const reports = input.reports.filter((r) => r.date <= input.asOf).sort((a, b) => a.date.localeCompare(b.date));
  for (const r of reports) {
    // 作業内容の行 → 重み
    const weightMap = new Map<string, number>();
    const lineCount = new Map<string, number>();
    let resolvedLines = 0;
    const filled = r.lines.flatMap((l) => (l.kind === 'work' && !isBlankManDays(l.manDays) ? [l.stored.manDays] : []));
    const blankWeight = filled.length > 0 ? filled.reduce((s, x) => s + x, 0) / filled.length : 1;
    for (const l of r.lines) {
      if (l.kind !== 'work') continue;
      const tradeId = resolve(l);
      const bucket = tradeId ?? OUTSIDE;
      const md = l.stored.manDays;
      addTo(weightMap, bucket, isBlankManDays(l.manDays) ? blankWeight : md);
      addTo(lineCount, bucket, 1);
      if (tradeId !== null) resolvedLines += 1;
      else {
        outsideWorkLineCount += 1;
        outsideWorkManDays += md;
      }
      const d = dayOf(bucket, r.date);
      d.workManDays += md;
      d.lines.push({
        trade: l.trade,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        manDays: isBlankManDays(l.manDays) ? null : md,
        changeKind: l.changeKind,
      });
      const pu = tradeId === null ? undefined : progressUnit.get(tradeId);
      if (tradeId !== null && pu && l.qty !== null && Number.isFinite(l.qty) && normalizeUnit(l.unit) === pu.unit) {
        d.qty = (d.qty ?? 0) + l.qty;
        addTo(tradeQty, tradeId, l.qty);
        qtyMatched.add(tradeId);
      }
    }
    let dayWeights: Weight[];
    if (resolvedLines === 0) dayWeights = [{ key: OUTSIDE, w: 1, order: orderOf(OUTSIDE) }];
    else {
      dayWeights = [...weightMap].map(([key, w]) => ({ key, w, order: orderOf(key) }));
      if (dayWeights.every((x) => x.w <= 0)) {
        dayWeights = [...lineCount].filter(([key]) => key !== OUTSIDE).map(([key, n]) => ({ key, w: n, order: orderOf(key) }));
      }
    }

    // 労務の行 → 施工者ごと（自社＋所属なし／協力会社ごと）にまとめる
    const labor = new Map<string, { supplierId: string | null; partner: boolean; amount: number; manDays: number }>();
    for (const l of r.lines) {
      switch (l.kind) {
        case 'labor': {
          // 繰越のある作業員の繰越の基準日より前の行は、繰越初期値に含まれているので数えない
          const before = l.workerId !== null ? beforeDates.get(l.workerId) : undefined;
          if (before !== undefined && r.date < before) break;
          const partner = l.affiliation === 'partner';
          const supplierId = partner ? (l.supplierId ?? null) : null;
          const key = partner ? `partner:${supplierId ?? ''}` : 'own';
          const cur = labor.get(key) ?? { supplierId, partner, amount: 0, manDays: 0 };
          cur.amount += l.stored.amount;
          cur.manDays += l.stored.manDays;
          labor.set(key, cur);
          break;
        }
        case 'fuel': siteActual.fuel += l.stored.amount; break;
        case 'lease': siteActual.lease += l.stored.amount; break;
        case 'cash': siteActual.cash += l.stored.amount; break;
        case 'credit': siteActual.credit += l.stored.amount; break;
        default: break;
      }
    }

    for (const [perfKey, g] of labor) {
      let weights = dayWeights;
      if (resolvedLines > 0 && g.partner && g.supplierId !== null) {
        const ts = supplierTrades.get(g.supplierId) ?? [];
        if (ts.length === 1) weights = [{ key: ts[0], w: 1, order: orderOf(ts[0]) }];
        else if (ts.length >= 2) {
          const restricted = dayWeights.filter((x) => ts.includes(x.key));
          weights = restricted.some((x) => x.w > 0) ? restricted : ts.map((t) => ({ key: t, w: 1, order: orderOf(t) }));
        }
      }
      const amounts = apportion(g.amount, weights, 1);
      const manDays = apportion(round9(g.manDays), weights, 0.01);
      for (const bucket of new Set([...amounts.keys(), ...manDays.keys()])) {
        const a = amounts.get(bucket) ?? 0;
        const m = manDays.get(bucket) ?? 0;
        addActual(bucket, perfKey, a, m);
        const d = dayOf(bucket, r.date);
        d.amount += a;
        d.manDays += m;
      }
    }
  }

  // 実行予算
  const budgetByTrade = new Map<string, BudgetLine[]>();
  const outsideBudget = { amount: 0, manDays: 0 };
  const siteBudget = { material: 0, lease: 0, other: 0 };
  for (const b of data.budgetLines) {
    if (SITE_WIDE_ITEMS.includes(b.item)) {
      if (b.item === 'material') siteBudget.material += b.amount;
      else if (b.item === 'lease') siteBudget.lease += b.amount;
      else siteBudget.other += b.amount;
      continue;
    }
    if (b.tradeId === null || !tradeIds.has(b.tradeId)) {
      outsideBudget.amount += b.amount;
      if (countsAsManDays(b)) outsideBudget.manDays += b.qty;
      continue;
    }
    const list = budgetByTrade.get(b.tradeId) ?? [];
    list.push(b);
    budgetByTrade.set(b.tradeId, list);
  }

  const partnerById = new Map(input.sitePartners.map((p) => [p.supplierId, p]));
  const partnerName = (supplierId: string | null): string =>
    (supplierId ? partnerById.get(supplierId)?.name || input.supplierNames?.[supplierId] : undefined) || UNKNOWN_PARTNER_LABEL;

  const performerRows = (budgetLines: BudgetLine[], actual: Map<string, Acc> | undefined, includeOwn: boolean): PerformerRow[] => {
    const rows = new Map<string, PerformerRow>();
    const rowOf = (key: string, supplierId: string | null, partner: boolean): PerformerRow => {
      let row = rows.get(key);
      if (!row) {
        row = {
          performer: partner ? 'partner' : 'own',
          supplierId,
          name: partner ? partnerName(supplierId) : OWN_LABEL,
          budgetAmount: 0,
          budgetManDays: null,
          actualAmount: 0,
          actualManDays: 0,
          partnerContract: partner && supplierId ? (partnerById.get(supplierId)?.amount ?? null) : null,
        };
        rows.set(key, row);
      }
      return row;
    };
    if (includeOwn) rowOf('own', null, false);
    for (const b of budgetLines) {
      const partner = b.performer === 'partner';
      const row = rowOf(partner ? performerKey(b.supplierId) : 'own', partner ? b.supplierId : null, partner);
      row.budgetAmount += b.amount;
      if (countsAsManDays(b)) row.budgetManDays = round9((row.budgetManDays ?? 0) + b.qty);
    }
    for (const [key, acc] of actual ?? []) {
      const partner = key !== 'own';
      const supplierId = partner ? key.slice('partner:'.length) || null : null;
      const row = rowOf(key, supplierId, partner);
      row.actualAmount += acc.amount;
      row.actualManDays = round9(row.actualManDays + acc.manDays);
    }
    const list = [...rows.values()];
    const own = list.filter((r) => r.performer === 'own');
    const partners = list.filter((r) => r.performer === 'partner').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return [...own, ...partners];
  };

  const daysOf = (bucket: string, unit: string | null): TradeDay[] =>
    [...(days.get(bucket)?.values() ?? [])]
      .filter((d) => d.lines.length > 0 || d.amount !== 0 || d.manDays !== 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        manDays: round9(d.manDays),
        amount: d.amount,
        workManDays: round9(d.workManDays),
        qty: d.qty === null ? null : round9(d.qty),
        unit: d.qty === null ? null : unit,
        lines: d.lines,
      }));

  const overrideOf = new Map(data.progress.map((p) => [p.tradeId, p.percent]));

  const trades: TradeRow[] = orderedTrades.map((t) => {
    const budgetLines = budgetByTrade.get(t.id) ?? [];
    const byPerformer = performerRows(budgetLines, tradeActual.get(t.id), true);
    const contractItems = contractByTrade.get(t.id) ?? [];
    const contractAmount = contractItems.reduce((s, c) => s + c.amount, 0);
    const budgetAmount = budgetLines.reduce((s, b) => s + b.amount, 0);
    const budgetManDays = round9(byPerformer.reduce((s, p) => s + (p.budgetManDays ?? 0), 0));
    const actualAmount = byPerformer.reduce((s, p) => s + p.actualAmount, 0);
    const actualManDays = round9(byPerformer.reduce((s, p) => s + p.actualManDays, 0));

    const pu = progressUnit.get(t.id);
    const qty = pu && qtyMatched.has(t.id) ? round9(tradeQty.get(t.id) ?? 0) : null;
    const fromQty = pu && pu.denominator !== 0 && qty !== null ? (qty / pu.denominator) * 100 : null;
    const override = overrideOf.get(t.id) ?? null;
    const raw = override ?? fromQty;
    const used = raw === null ? null : Math.min(100, Math.max(0, raw));

    let forecast: number | null = null;
    let forecastProfit: number | null = null;
    let status: TradeRow['status'] = 'none';
    if (used !== null && used > 0) {
      forecast = Math.round(actualAmount / (used / 100));
      const hasContract = contractItems.length > 0;
      forecastProfit = hasContract ? contractAmount - forecast : null;
      if (forecast > contractAmount) status = hasContract ? 'loss' : 'none';
      else status = forecast > budgetAmount ? 'overBudget' : 'ok';
    }

    return {
      tradeId: t.id,
      name: t.name,
      contractAmount,
      contractItemCount: contractItems.length,
      budget: { amount: budgetAmount, manDays: budgetManDays, byPerformer },
      actual: { amount: actualAmount, manDays: actualManDays, byPerformer, qty, unit: pu ? pu.label : null },
      progress: { used, fromQty, override },
      forecast,
      forecastProfit,
      status,
      days: daysOf(t.id, pu ? pu.label : null),
    };
  });

  const outsidePerformers = performerRows([], tradeActual.get(OUTSIDE), false).filter(
    (p) => p.actualAmount !== 0 || p.actualManDays !== 0,
  );
  const outside: OutsideRow = {
    budget: { amount: outsideBudget.amount, manDays: round9(outsideBudget.manDays) },
    amount: outsidePerformers.reduce((s, p) => s + p.actualAmount, 0),
    manDays: round9(outsidePerformers.reduce((s, p) => s + p.actualManDays, 0)),
    byPerformer: outsidePerformers,
    workLineCount: outsideWorkLineCount,
    workManDays: round9(outsideWorkManDays),
    days: daysOf(OUTSIDE, null),
    carryover:
      carryovers.length === 0
        ? null
        : {
            manDays: round9(carryovers.reduce((s, c) => s + c.manDays, 0)),
            amount: carryovers.reduce((s, c) => s + c.laborCost, 0),
          },
  };

  let contractExpense = 0;
  let contractReduction = 0;
  let contractUnassigned = 0;
  let contractAll = 0;
  for (const c of data.contractItems) {
    contractAll += c.amount;
    if (c.category === 'expense') contractExpense += c.amount;
    else if (c.category === 'reduction') contractReduction += c.amount;
    else if (!c.tradeId || !tradeIds.has(c.tradeId)) contractUnassigned += c.amount;
  }

  const siteWide: SiteWideRow = {
    budget: { ...siteBudget, amount: siteBudget.material + siteBudget.lease + siteBudget.other },
    actual: { ...siteActual, amount: siteActual.fuel + siteActual.lease + siteActual.cash + siteActual.credit },
    contractExpense,
  };

  const total: TotalRow = {
    contractAmount: contractAll,
    contractTradeAmount: trades.reduce((s, t) => s + t.contractAmount, 0),
    contractExpense,
    contractReduction,
    contractUnassigned,
    budgetAmount: trades.reduce((s, t) => s + t.budget.amount, 0) + outside.budget.amount + siteWide.budget.amount,
    actualAmount:
      trades.reduce((s, t) => s + t.actual.amount, 0) + outside.amount + (outside.carryover?.amount ?? 0) + siteWide.actual.amount,
    actualManDays: round9(
      trades.reduce((s, t) => s + t.actual.manDays, 0) + outside.manDays + (outside.carryover?.manDays ?? 0),
    ),
  };

  return { asOf: input.asOf, dailyRate: input.dailyRate, trades, outside, siteWide, total };
}

/**
 * まだ工種に決まらない日報の工種の文字（読み替え表の候補）を、集計の入力（asOf までの日報）から数える。
 * 予算と実績の画面で使う（日報を読み直さない。asOf より後の日報は数えない）。
 */
export function unmappedTradeTextsOf(input: Pick<BudgetModelInput, 'data' | 'reports' | 'asOf'>): UnmappedTradeText[] {
  const lines = input.reports
    .filter((r) => r.date <= input.asOf)
    .flatMap((r) => r.lines.flatMap((l) => (l.kind === 'work' ? [{ siteTradeId: l.siteTradeId, trade: l.trade, manDays: l.manDays }] : [])));
  return unmappedTradeTexts(lines, aliasMap(input.data.aliases), tradesByNameMap(input.data.trades));
}
