import { amount, fuelCost, laborLineValues, productivity, workAmount } from '@/lib/calc/report';
import { EMPTY_WORK_CHANGE, isChangeKind, isInstructionMethod } from '@/lib/report/change-labels';
import { isUnnamedLabor } from '@/lib/report/unnamed-workers';
import type { Affiliation, ChangeKind, InstructionMethod, LaborContract, LaborLine, LaborRule, LaborSaved, PurchaseKind, ReportLine, TimeSpec } from '@/lib/types';
import type { SaveInput } from '@/lib/report/schema';

// 日報の明細と gn_report_lines の列の相互変換（純関数。サーバーの読み書きから使う）。
// 計算値（hours・man_days・overtime_hours・amount・productivity）はここでも計算して送るが、DB のトリガー
// （gn_report_lines_compute）が入力値から同じ式で計算し直すので、保存される値は DB 側の計算になる。
// jsonb_populate_record は数値・uuid 列に "" を渡すとエラーになるため、空値は必ず null で送る。

/** gn_report_lines の1行（id・report_id・created_at を除く）。 */
export interface LineRow {
  kind: ReportLine['kind'];
  sort_order: number;
  ref_id: string | null;
  name: string | null;
  spec: string | null;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
  start_time: string | null;
  end_time: string | null;
  break_min: number | null;
  gap_min: number | null;
  hours: number | null;
  man_days: number | null;
  km_per_l: number | null;
  distance_km: number | null;
  price_per_l: number | null;
  vendor: string | null;
  trade: string | null;
  description: string | null;
  productivity: number | null;
  source: 'estimate' | 'extra' | null;
  note: string | null;
  /** 労務の残業時間（H。計算値）。労務以外は null。 */
  overtime_hours: number | null;
  /** 労務の残業単価の上書き（作業員の残業単価。無ければ null で、DB が標準の計算式を使う）。 */
  overtime_rate: number | null;
  /** 作業内容の区分・指示（追加・増・変更・減の記録）。作業内容以外は null（DB は区分を 'contract' にする）。 */
  change_kind: ChangeKind | null;
  instructed_by: string | null;
  instruction_method: InstructionMethod | null;
  instructed_on: string | null;
  issue_id: string | null;
  /** 労務の行の常用・請負（null は常用扱い）と、保存時の所属の写し（手入力の行は null）。労務以外は null。 */
  labor_contract: LaborContract | null;
  affiliation: Affiliation | null;
  supplier_id: string | null;
  /**
   * 実行予算の工種（gn_site_trades.id。null＝選んでいない）。作業内容の行と外注の買掛の行だけ（2026-11-17）。
   * それ以外は null（DB も null にする）。
   */
  site_trade_id: string | null;
  /** 買掛の区分（'material' 仕入・'subcontract' 外注。2026-11-17）。買掛以外は null。DB の null は仕入。 */
  purchase_kind: PurchaseKind | null;
  /** 作業員の行のうち常用の時間（H。2026-11-17）。作業員以外は null。 */
  jouyou_hours: number | null;
  /**
   * 人数（2026-11-19）。名前なし（会社と人数）の作業員の行だけ（1 以上）。それ以外は null（DB も null にする）。
   * 人工・残業・金額は人数分、実働（hours）は 1 人あたり（src/lib/report/unnamed-workers.ts）。
   */
  headcount: number | null;
}

/** gn_save_report の p_report。 */
export interface ReportRow {
  site_id: string;
  report_date: string;
  weather: string | null;
  supervisor: string | null;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | null;
  common_gap_min: number | null;
  issues_text: string | null;
  notes_text: string | null;
  /** 楽観ロック：画面を開いたときの updated_at。null なら比べない（新しい日報など）。 */
  expected_updated_at?: string | null;
}

const EMPTY_ROW: Omit<LineRow, 'kind' | 'sort_order'> = {
  ref_id: null, name: null, spec: null, unit: null, qty: null, unit_price: null, amount: null,
  start_time: null, end_time: null, break_min: null, gap_min: null, hours: null, man_days: null,
  km_per_l: null, distance_km: null, price_per_l: null, vendor: null, trade: null, description: null,
  productivity: null, source: null, note: null, overtime_hours: null, overtime_rate: null,
  change_kind: null, instructed_by: null, instruction_method: null, instructed_on: null, issue_id: null,
  labor_contract: null, affiliation: null, supplier_id: null, site_trade_id: null,
  purchase_kind: null, jouyou_hours: null, headcount: null,
};

function text(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

// 浮動小数の誤差（20330.000000000004 など）を落とす。
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function toLineRow(line: ReportLine, common: TimeSpec, sortOrder: number, rule: LaborRule): LineRow {
  const base = { ...EMPTY_ROW, kind: line.kind, sort_order: sortOrder };
  switch (line.kind) {
    case 'labor': {
      const v = laborLineValues(line, common, rule);
      const otRate = num(line.overtimeRate);
      return {
        ...base,
        ref_id: text(line.workerId),
        name: text(line.workerName),
        start_time: text(line.time.start),
        end_time: text(line.time.end),
        break_min: num(line.time.breakMin),
        gap_min: num(line.time.gapMin),
        hours: clean(v.hours),
        man_days: clean(v.manDays),
        unit_price: num(line.dailyRate),
        amount: clean(v.cost),
        note: text(line.note),
        overtime_hours: clean(v.overtimeHours),
        // 0 は「標準の計算式」と同じ意味なので null で送る。
        overtime_rate: otRate === null || otRate === 0 ? null : otRate,
        labor_contract: line.laborContract ?? null,
        affiliation: line.affiliation ?? null,
        supplier_id: text(line.supplierId),
        jouyou_hours: num(line.jouyouHours),
        // 人数は名前なしの行（作業員を選んでいない行）だけ。
        headcount: !line.workerId && isUnnamedLabor(line) ? num(line.headcount) : null,
      };
    }
    case 'fuel':
      return {
        ...base,
        ref_id: text(line.vehicleId),
        name: text(line.vehicleName),
        km_per_l: num(line.kmPerL),
        distance_km: num(line.distanceKm),
        price_per_l: num(line.pricePerL),
        amount: clean(fuelCost(line.distanceKm, line.kmPerL, line.pricePerL)),
        note: text(line.note),
        issue_id: text(line.issueId),
      };
    case 'lease':
      return {
        ...base,
        ref_id: text(line.itemId),
        name: text(line.itemName),
        spec: text(line.spec),
        unit: text(line.unit),
        qty: num(line.qty),
        unit_price: num(line.unitPrice),
        amount: clean(amount(line.qty, line.unitPrice)),
        note: text(line.note),
        issue_id: text(line.issueId),
      };
    case 'cash':
    case 'credit': {
      const row: LineRow = {
        ...base,
        ref_id: line.kind === 'credit' ? text(line.supplierId) : null,
        name: text(line.itemName),
        spec: text(line.spec),
        unit: text(line.unit),
        qty: num(line.qty),
        unit_price: num(line.unitPrice),
        amount: clean(amount(line.qty, line.unitPrice)),
        vendor: text(line.vendor),
        issue_id: text(line.issueId),
      };
      if (line.kind === 'cash') return row;
      // 工種は外注の行だけ（仕入の行は選んでいても送らない。DB も null にする）。
      const sub = line.purchaseKind === 'subcontract';
      return { ...row, purchase_kind: sub ? 'subcontract' : 'material', site_trade_id: sub ? text(line.siteTradeId) : null };
    }
    case 'work': {
      const p = productivity(line.qty, line.manDays);
      return {
        ...base,
        ref_id: text(line.estimateItemId),
        trade: text(line.trade),
        description: text(line.description),
        qty: num(line.qty),
        unit: text(line.unit),
        man_days: num(line.manDays),
        unit_price: num(line.unitPrice),
        amount: clean(workAmount(line)),
        productivity: p === null ? null : clean(p),
        source: line.source,
        change_kind: line.changeKind,
        instructed_by: text(line.instructedBy),
        instruction_method: line.instructionMethod,
        instructed_on: text(line.instructedOn),
        issue_id: text(line.issueId),
        site_trade_id: text(line.siteTradeId),
      };
    }
  }
}

export function toLineRows(lines: ReportLine[], common: TimeSpec, rule: LaborRule): LineRow[] {
  return lines.map((l, i) => toLineRow(l, common, i, rule));
}

export function toReportRow(v: SaveInput): ReportRow {
  return {
    site_id: v.siteId,
    report_date: v.date,
    weather: text(v.weather),
    supervisor: text(v.supervisor),
    common_start: text(v.common.start),
    common_end: text(v.common.end),
    common_break_min: num(v.common.breakMin),
    common_gap_min: num(v.common.gapMin),
    issues_text: text(v.issuesText),
    notes_text: text(v.notesText),
  };
}

// ─── 読み取り（DB → 明細） ───

/** PostgREST から返る行（numeric は文字列のこともある）。 */
export type LineRowRead = { [K in keyof LineRow]?: LineRow[K] | string | null };

function rNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function rId(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function rTime(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function isLaborContract(v: unknown): v is LaborContract {
  return v === 'jouyou' || v === 'ukeoi';
}
function rPurchaseKind(v: unknown): PurchaseKind {
  return v === 'subcontract' ? 'subcontract' : 'material';
}
function isAffiliation(v: unknown): v is Affiliation {
  return v === 'own' || v === 'partner';
}
function rDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** 労務行の DB の計算値（保存時の設定で計算済み）。残業列が無い移行前の行は残業 0 とみなす。実働・人工・金額のどれかが null なら付けない（画面で計算する）。 */
function savedValues(r: LineRowRead): { saved?: LaborSaved } {
  const hours = rNum(r.hours);
  const manDays = rNum(r.man_days);
  const overtimeHours = rNum(r.overtime_hours) ?? 0;
  const cost = rNum(r.amount);
  if (hours === null || manDays === null || cost === null) return {};
  return { saved: { hours, manDays, overtimeHours, cost } };
}

function headcountOf(r: LineRowRead): { headcount?: number } {
  const n = rNum(r.headcount);
  return n === null ? {} : { headcount: n };
}

/** 種類が不明な行は null（読み飛ばす）。 */
export function fromLineRow(r: LineRowRead): ReportLine | null {
  switch (r.kind) {
    case 'labor':
      return {
        kind: 'labor',
        workerId: rId(r.ref_id),
        workerName: rStr(r.name),
        time: { start: rTime(r.start_time), end: rTime(r.end_time), breakMin: rNum(r.break_min), gapMin: rNum(r.gap_min) },
        dailyRate: rNum(r.unit_price),
        note: rStr(r.note),
        overtimeRate: rNum(r.overtime_rate),
        // 列の無い・移行前の行は null（常用・所属なし）。
        laborContract: isLaborContract(r.labor_contract) ? r.labor_contract : null,
        affiliation: isAffiliation(r.affiliation) ? r.affiliation : null,
        supplierId: rId(r.supplier_id),
        // 列の無い・移行前の行は null（全部が請負。常用の行では使わない）。
        jouyouHours: rNum(r.jouyou_hours),
        // 人数は名前なし（会社と人数）の行だけ持つ（列の無い・移行前の行・名前のある行は項目なし＝1 人）。
        ...headcountOf(r),
        ...savedValues(r),
      };
    case 'fuel':
      return {
        kind: 'fuel',
        vehicleId: rId(r.ref_id),
        vehicleName: rStr(r.name),
        kmPerL: rNum(r.km_per_l),
        distanceKm: rNum(r.distance_km),
        pricePerL: rNum(r.price_per_l),
        note: rStr(r.note),
        issueId: rId(r.issue_id),
      };
    case 'lease':
      return {
        kind: 'lease',
        itemId: rId(r.ref_id),
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        note: rStr(r.note),
        issueId: rId(r.issue_id),
      };
    case 'cash':
      return {
        kind: 'cash',
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        vendor: rStr(r.vendor),
        issueId: rId(r.issue_id),
      };
    case 'credit': {
      // 列の無い・移行前の行・null は仕入（工種なし）。
      const purchaseKind = rPurchaseKind(r.purchase_kind);
      return {
        kind: 'credit',
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        supplierId: rId(r.ref_id),
        vendor: rStr(r.vendor),
        purchaseKind,
        siteTradeId: purchaseKind === 'subcontract' ? rId(r.site_trade_id) : null,
        issueId: rId(r.issue_id),
      };
    }
    case 'work':
      return {
        kind: 'work',
        estimateItemId: rId(r.ref_id),
        trade: rStr(r.trade),
        description: rStr(r.description),
        qty: rNum(r.qty),
        unit: rStr(r.unit),
        manDays: rNum(r.man_days),
        unitPrice: rNum(r.unit_price),
        source: r.source === 'estimate' ? 'estimate' : 'extra',
        // 列の無い・移行前の行は契約内・指示なし。
        changeKind: isChangeKind(r.change_kind) ? r.change_kind : EMPTY_WORK_CHANGE.changeKind,
        instructedBy: rStr(r.instructed_by),
        instructionMethod: isInstructionMethod(r.instruction_method) ? r.instruction_method : null,
        instructedOn: rDate(r.instructed_on),
        issueId: rId(r.issue_id),
        // 列の無い・移行前の行は工種を選んでいない（null）。
        siteTradeId: rId(r.site_trade_id),
      };
    default:
      return null;
  }
}

/** 労務行から DB の計算値（saved）を除く（保存・下書き・前回コピーには持ち込まない）。 */
export function withoutSaved(l: LaborLine): LaborLine {
  if (l.saved === undefined) return l;
  const { saved: _saved, ...rest } = l;
  void _saved;
  return rest;
}

/**
 * 前回コピー: 作業員・車両・リースだけを複写。作業員の個別時間・うち常用の時間と車両の走行距離は空にする（リースの数量・残業単価はそのまま）。
 * 名前なし（会社と人数）の行は会社・人数・常用請負をそのまま複写する。
 * 根拠の件はその日のものなので持ち込まない。
 */
export function copyableLines(lines: ReportLine[]): ReportLine[] {
  const out: ReportLine[] = [];
  for (const l of lines) {
    if (l.kind === 'labor') {
      const base = { ...withoutSaved(l), time: { start: null, end: null, breakMin: null, gapMin: null } };
      out.push(l.jouyouHours === undefined ? base : { ...base, jouyouHours: null });
    } else if (l.kind === 'fuel') out.push({ ...l, distanceKm: null, issueId: null });
    else if (l.kind === 'lease') out.push({ ...l, issueId: null });
  }
  return out;
}

/** 他の端末で更新・削除されていたときの文言（楽観ロック）。 */
/** 完了（status='done'）または削除済みの現場で日報・明細・重要事項を変えようとしたとき（DB の site_closed）。 */
export const SITE_CLOSED_MESSAGE =
  'この現場は完了（または削除）されているため変更できません。管理者が進行中に戻すと入力できます。';
/** 承認済みの日報を変えようとしたとき（DB の approved_report_locked）。画面の帯と取り込みでも同じ文言を出す。 */
export const APPROVED_LOCKED_MESSAGE = '承認済みのため編集できません';
export const STALE_REPORT_MESSAGE = '他の端末で更新されています。画面を再読み込みしてから保存してください。';
/** 客先確認の記録・取り消しで、他の端末で日報が更新されていたとき（保存するものは無いので「もう一度記録」）。 */
export const STALE_CONFIRMATION_MESSAGE = '他の端末で更新されています。画面を再読み込みしてから、もう一度記録してください。';

/** gn_save_report / ガードトリガーのエラーを利用者向けの文言に変換する。 */
export function saveErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  if (m.includes('stale_report')) return STALE_REPORT_MESSAGE;
  if (m.includes('approved_report_locked')) return APPROVED_LOCKED_MESSAGE;
  if (m.includes('not_reviewer')) return 'この現場の確認者・承認者ではありません';
  // 作業内容の行の工種がこの現場に無い（他の端末で消された・別の現場の工種）。gn_report_lines_trade。
  if (m.includes('trade_not_in_site')) return '選んだ工種がこの現場の実行予算にありません。画面を再読み込みして選び直してください';
  // 行の根拠の件がこの現場に無い（別の現場の件）。gn_report_lines_issue（2026-11-17）。
  if (m.includes('issue_not_in_site')) return '選んだ件がこの現場にありません。画面を再読み込みして選び直してください';
  return '保存に失敗しました。通信状況を確認してもう一度お試しください。';
}

/** 承認解除の権限が無いとき（DB の gn_report_guard が not_reviewer / approved_report_locked を返す）。 */
export const REOPEN_FORBIDDEN_MESSAGE = 'この現場の確認者・承認者か管理者だけが承認を解除できます';

/**
 * 承認解除（approved → draft）のエラーを利用者向けの文言に変える。権限はアプリでは判定せず DB のガードに任せ、
 * 権限が無いときの not_reviewer / approved_report_locked を「確認者・承認者か管理者だけ」の文言にする。
 * 該当しなければ null（呼び出し側の共通の文言を使う）。
 */
export function reopenErrorMessage(dbMessage: string | null | undefined): string | null {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  if (m.includes('not_reviewer') || m.includes('approved_report_locked')) return REOPEN_FORBIDDEN_MESSAGE;
  return null;
}

/** 未解決の修正申請がすでにある日報に、もう一つ出したとき（一意索引 gn_report_fix_requests_open_uidx・23505）。 */
export const FIX_REQUEST_DUPLICATE_MESSAGE = 'この日報には、すでに修正申請が出ています';

/** 修正申請（gn_report_fix_requests のガード・RLS・一意索引）のエラーを利用者向けの文言に変える。該当しなければ null。 */
export function fixRequestErrorMessage(dbMessage: string | null | undefined): string | null {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  if (m.includes('report_not_submitted')) return '修正の申請は、提出済みか承認済みの日報だけ出せます';
  if (m.includes('gn_report_fix_requests_open_uidx') || m.includes('duplicate key')) return FIX_REQUEST_DUPLICATE_MESSAGE;
  if (m.includes('not_report_owner')) return '協力会社のアカウントは、自分が作った日報だけ修正を申請できます';
  if (m.includes('report_not_found')) return '日報が見つからないか、権限がありません';
  // RLS の一般の拒否は理由が分からないので、協力会社の文言にはしない
  if (m.includes('row-level security')) return '修正を申請する権限がありません';
  return null;
}
