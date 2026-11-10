export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type SiteRole = 'staff' | 'reviewer' | 'approver';
export type LineKind = 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'work';
export interface TimeSpec { start: string | null; end: string | null; breakMin: number | null; gapMin: number | null; }
/** 保存済みの労務行の DB の計算値（トリガー gn_report_lines_compute が保存時の設定で計算したもの）。読み取り専用の表示に使い、保存には送らない。 */
export interface LaborSaved { hours: number; manDays: number; overtimeHours: number; cost: number; }
/** 作業員の所属：自社（own）・協力会社（partner。取引先の 1 社）。協力会社の上下（1 次・2 次）は持たない。 */
export type Affiliation = 'own' | 'partner';
/** 労務の行の支払い・精算の区分：常用（jouyou）・請負（ukeoi）。原価（労務費）の計算は変えない。 */
export type LaborContract = 'jouyou' | 'ukeoi';
/**
 * 労務の行。laborContract・affiliation・supplierId は 2026-11-07 追加（古い下書き・行には無いので省略可）。
 * - laborContract：常用・請負。所属が協力会社の作業員の行だけ値を持つ（保存時に、協力会社の行は null → 'jouyou'、
 *   それ以外の行は null にそろえる。src/lib/report/snapshots.ts）。null・省略は常用扱い。
 * - affiliation・supplierId：その日の所属の写し。保存時にサーバーが作業員マスターから写す（画面から送った値は使わない）。
 *   手入力の行（workerId なし）は null ＝ 所属なし。帳票はこの値を使う。
 */
export interface LaborLine  {
  kind: 'labor'; workerId: string | null; workerName: string; time: TimeSpec; dailyRate: number | null; note: string; overtimeRate: number | null; saved?: LaborSaved;
  laborContract?: LaborContract | null;
  affiliation?: Affiliation | null;
  supplierId?: string | null;
  /**
   * うち常用の時間（H。2026-11-17）。区分が請負の行で、請負の外で常用として働いた時間。null・省略は全部が請負。
   * 保存時に、区分が請負でない行は null にそろえる（src/lib/report/snapshots.ts）。
   */
  jouyouHours?: number | null;
  /**
   * 人数（2026-11-19）。名前なし（会社と人数）の行だけ入る（1 以上の整数。画面で空にしている間は 0）。
   * null・省略は名前のある行（1 人）。src/lib/report/unnamed-workers.ts。
   */
  headcount?: number | null;
}
// 燃料・リース・現金・買掛の issueId は根拠の件（gn_report_issues.id。2026-11-17。null＝根拠なし＝通常の工事の分）。
export interface FuelLine   { kind: 'fuel';   vehicleId: string | null; vehicleName: string; kmPerL: number | null; distanceKm: number | null; pricePerL: number | null; note: string; issueId: string | null; }
export interface LeaseLine  { kind: 'lease';  itemId: string | null; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; note: string; issueId: string | null; }
export interface CashLine   { kind: 'cash';   itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string; issueId: string | null; }
/** 買掛の区分：仕入（material。材料など）・外注（subcontract。請負の支払い。2026-11-17）。 */
export type PurchaseKind = 'material' | 'subcontract';
/**
 * 買掛の行。supplierId・vendor は支払先。purchaseKind・siteTradeId・issueId は 2026-11-17 追加。
 * siteTradeId（実行予算の工種）は外注の行だけ持つ（仕入の行は保存時に null）。外注の行は社員・管理者だけが読み書きできる（RLS）。
 */
export interface CreditLine {
  kind: 'credit'; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; supplierId: string | null; vendor: string;
  purchaseKind: PurchaseKind; siteTradeId: string | null; issueId: string | null;
}
/**
 * 作業内容の区分（契約内・追加・増・変更・減）。表示名は src/lib/report/change-labels.ts。
 * 追加（extra）は新しく別の仕事が増えたもの、増（increase）は同じ流れの中で数量が増えたもの。計算・集計は増も追加と同じ。
 */
export type ChangeKind = 'contract' | 'extra' | 'increase' | 'change' | 'minus';
/** 指示方法（口頭・電話・メール・書面・その他・指示なし（現場判断））。site は指示が無く現場の状況でやったもの（指示者は空でよい）。 */
export type InstructionMethod = 'oral' | 'phone' | 'email' | 'document' | 'other' | 'site';
/**
 * 重要事項の件の種別（追加指示・増（数量増）・仕様変更・減・客先都合・やり直し・その他・現場判断（要協議））。
 * site_judgment は指示が無いのに現場の状況でやった作業（精算はあとで協議。数え方は追加と同じ）。
 */
export type IssueKind = 'extra' | 'increase' | 'change' | 'minus' | 'client_delay' | 'rework' | 'other' | 'site_judgment';
/**
 * 重要事項の件の状態（見積中・対応中・完了）。見積中と対応中は完了まで日報の上の枠に出続ける。
 * 精算の資料の「見積中の件」（金額が確定していない件）とは別のもの。
 */
export type IssueStatus = 'estimating' | 'open' | 'done';
/**
 * 件の精算の方法（未定・一式＝おおよその一括額で精算・見積＝材料などがはっきりしてからの見積額で精算・常用＝人工 × 常用単価で精算）。
 * 一式と見積の計算は同じ（確定額 fixedAmount）。
 */
export type SettlementMethod = 'undecided' | 'lump_sum' | 'estimate' | 'daily_rate';
/**
 * 作業内容の行。source は見積の行との対応（estimate＝見積の行から、extra＝見積に無い行）で、
 * changeKind が追加・増・変更・減の区分。instructedBy〜issueId は追加・増・変更・減の根拠（誰が・どう・いつ指示したか、根拠の件）。
 */
export interface WorkLine   {
  kind: 'work'; estimateItemId: string | null; trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; source: 'estimate' | 'extra';
  changeKind: ChangeKind;
  /** 指示者（'' は未入力）。 */
  instructedBy: string;
  instructionMethod: InstructionMethod | null;
  /** 指示日（YYYY-MM-DD）。 */
  instructedOn: string | null;
  /** 根拠の件（gn_report_issues.id）。 */
  issueId: string | null;
  /** 実行予算の工種（gn_site_trades.id）。null＝選んでいない（読み替え表 → 予算外の順で決める）。 */
  siteTradeId: string | null;
}
export type ReportLine = LaborLine | FuelLine | LeaseLine | CashLine | CreditLine | WorkLine;
/**
 * 日報の画面の集計。credit は買掛の全部（仕入＋外注）、subcontract はそのうちの外注（2026-11-17）。cost に外注は 1 回だけ入る。
 * manDays は出面の人工（全部）。labor は原価に数える労務費（労務費の決まりを渡したとき。src/lib/calc/labor-cost.ts）、
 * ukeoiManDays はそのうち原価に数えない請負の人工。
 */
export interface ReportTotals { laborHours: number; manDays: number; ukeoiManDays: number; overtimeHours: number; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; subcontract: number; cost: number; output: number; }
/** 人工・残業の計算設定（gn_settings。Excel 雛形 V34 の「労務の計算設定」と同じ）。 */
export interface LaborRule { shoteiHours: number; fixedOvertimeLimit: number; overtimeMultiplier: number; overtimeBaseHours: number; }
