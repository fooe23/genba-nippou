import type { ReportMasters } from '@/components/report/form-state';
import { aliasMap, resolveTradeId, tradesByNameMap } from '@/lib/budget/resolve-trade';
import type { SiteTrade, TradeAlias } from '@/lib/budget/types';
import { jpDate } from '@/lib/calc/format';
import { rateAt } from '@/lib/calc/rates';
import type { DaySheetParse } from '@/lib/import/day-sheet';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { ReportLineInput, SaveInput } from '@/lib/report/schema';

// 1 日分の雛形から読んだ内容 → 日報フォームに流し込む SaveInput（純関数）。
// 名前は前後の空白を除いた完全一致でマスターと突き合わせる。1 件に決まれば ID とマスターの単価を入れ、
// 決まらなければ（無い・同名が複数）名前だけの行（「（手入力）」の行）にして notes に書く。
// 作業内容の行の工種は、現場の読み替え表 → 工種の名前の完全一致で実行予算の工種（siteTradeId）に決める（工種の文字はそのまま）。

type Match<T> = { kind: 'one'; item: T } | { kind: 'none' } | { kind: 'many' };

/** 名前の完全一致。同名が複数あるときは有効なものだけで選び直す。 */
function matchName<T extends { name: string; active: boolean }>(list: T[], name: string): Match<T> {
  let hits = list.filter((x) => x.name.trim() === name);
  if (hits.length > 1) hits = hits.filter((x) => x.active);
  if (hits.length === 1) return { kind: 'one', item: hits[0] };
  return hits.length === 0 ? { kind: 'none' } : { kind: 'many' };
}

/** ファイルの計算済みの単価（VLOOKUP の値）は 0 なら「無い」。 */
const positive = (n: number | null) => (n !== null && n > 0 ? n : null);

export function toSaveInput(
  parse: DaySheetParse,
  siteId: string,
  date: string,
  masters: ReportMasters,
  /** 現場の実行予算の工種と読み替え表（呼び出し側で読んだもの）。省略・工種が空なら工種を決めない。 */
  budget: { trades: SiteTrade[]; aliases: TradeAlias[] } = { trades: [], aliases: [] },
): { input: SaveInput; notes: string[] } {
  const notes = [...parse.notes];
  if (parse.date !== null && parse.date !== date) {
    notes.push(`ファイルの日付（${jpDate(parse.date)}）と画面の日付（${jpDate(date)}）が違います。画面の日付で取り込みます`);
  }
  if (parse.weather !== null && !masters.weather.includes(parse.weather)) {
    notes.push(`天候「${parse.weather}」は選択肢に無いため、そのまま取り込みました`);
  }

  const lines: ReportLineInput[] = [];

  for (const l of parse.labor) {
    const m = matchName(masters.workers, l.name);
    if (m.kind === 'one') {
      const w = m.item;
      lines.push({
        kind: 'labor', workerId: w.id, workerName: w.name, time: l.time,
        dailyRate: rateAt(w.rates, date) ?? positive(l.dailyRate), overtimeRate: w.overtimeRate, note: l.note,
      });
    } else {
      notes.push(
        m.kind === 'none'
          ? `作業員「${l.name}」はマスターに無いので手入力として取り込みました`
          : `作業員「${l.name}」はマスターに同じ名前が複数あるため手入力として取り込みました`,
      );
      lines.push({ kind: 'labor', workerId: null, workerName: l.name, time: l.time, dailyRate: positive(l.dailyRate), overtimeRate: null, note: l.note });
    }
  }

  for (const l of parse.fuel) {
    const m = matchName(masters.vehicles, l.name);
    if (m.kind !== 'one') {
      notes.push(
        m.kind === 'none'
          ? `車両「${l.name}」はマスターに無いため手入力として取り込みました（燃費を入れるか、一覧から選び直してください）`
          : `車両「${l.name}」はマスターに同じ名前が複数あるため手入力として取り込みました（燃費を入れるか、一覧から選び直してください）`,
      );
    }
    const v = m.kind === 'one' ? m.item : null;
    lines.push({
      kind: 'fuel', vehicleId: v?.id ?? null, vehicleName: v?.name ?? l.name, kmPerL: v?.kmPerL ?? null,
      distanceKm: l.distanceKm, pricePerL: l.pricePerL, note: l.note, issueId: null,
    });
  }

  for (const l of parse.lease) {
    const m = matchName(masters.leaseItems, l.name);
    if (m.kind !== 'one') {
      notes.push(
        m.kind === 'none'
          ? `リース品「${l.name}」はマスターに無いため手入力として取り込みました（単価を確かめるか、一覧から選び直してください）`
          : `リース品「${l.name}」はマスターに同じ名前が複数あるため手入力として取り込みました（単価を確かめるか、一覧から選び直してください）`,
      );
    }
    const item = m.kind === 'one' ? m.item : null;
    lines.push({
      kind: 'lease', itemId: item?.id ?? null, itemName: item?.name ?? l.name,
      spec: l.spec || (item?.spec ?? ''), unit: l.unit, qty: l.qty,
      unitPrice: (item ? rateAt(item.rates, date) : null) ?? positive(l.unitPrice), note: l.note, issueId: null,
    });
  }

  for (const l of parse.cash) {
    lines.push({ kind: 'cash', itemName: l.name, spec: l.spec, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, vendor: l.vendor, issueId: null });
  }

  for (const l of parse.credit) {
    const m = l.vendor === '' ? null : matchName(masters.suppliers, l.vendor);
    if (m && m.kind !== 'one') {
      notes.push(
        m.kind === 'none'
          ? `買掛の仕入先「${l.vendor}」はマスターに無いので手入力として取り込みました`
          : `買掛の仕入先「${l.vendor}」はマスターに同じ名前が複数あるため手入力として取り込みました`,
      );
    }
    const s = m?.kind === 'one' ? m.item : null;
    lines.push({
      kind: 'credit', itemName: l.name, spec: l.spec, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice,
      supplierId: s?.id ?? null, vendor: s?.name ?? l.vendor,
      // 1 日分の Excel（V34）の買掛は仕入として取り込む（外注の区分・工種・根拠は画面で選ぶ）。
      purchaseKind: 'material', siteTradeId: null, issueId: null,
    });
  }

  const aliases = aliasMap(budget.aliases);
  const tradesByName = tradesByNameMap(budget.trades);
  const hasTrades = budget.trades.length > 0;
  parse.work.forEach((l, i) => {
    if (l.description === '') notes.push(`作業内容の ${i + 1} 行目（${l.trade}）は施工内容が空です。保存の前に入れてください`);
    const siteTradeId = hasTrades ? resolveTradeId({ siteTradeId: null, trade: l.trade }, aliases, tradesByName) : null;
    if (hasTrades && siteTradeId === null && l.trade.trim() !== '') {
      notes.push(`工種「${l.trade.trim()}」は実行予算の工種に当てはまらないため、文字のまま取り込みました（工種の欄で選び直せます）`);
    }
    lines.push({
      kind: 'work', estimateItemId: null, trade: l.trade, description: l.description, qty: l.qty, unit: l.unit,
      manDays: l.manDays, unitPrice: l.unitPrice, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId,
    });
  });

  return {
    input: {
      siteId,
      date,
      weather: parse.weather,
      supervisor: parse.supervisor,
      common: { ...parse.common },
      issuesText: parse.issuesText,
      notesText: parse.notesText,
      lines,
    },
    // 同じ注記（同じ仕入先の行が複数など）は 1 回だけ出す。
    notes: [...new Set(notes)],
  };
}
