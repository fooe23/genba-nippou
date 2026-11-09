import { fileNameStem } from '@/lib/export/payload';
import { BUDGET_ITEMS, BUDGET_ITEM_LABEL, CONTRACT_SECTIONS, CONTRACT_SECTION_LABEL } from '@/lib/budget/types';

// 実行予算・元請けの内訳の Excel 雛形の形（書き出し template-xlsx.ts と取り込み parse-template.ts で共有。純粋）。
// 見本：.superpowers/brainstorm/24602-1794232833/content/excel-1.html。1 行目＝現場の見出し、2 行目＝列見出し、3 行目から入力。

export const SHEET_BUDGET = '実行予算';
export const SHEET_CONTRACT = '元請けの内訳';
export const SHEET_CHOICES = '選択肢';

/** 実行予算の列（A〜H）。 */
export const BUDGET_HEADERS = ['工種', '施工者', '項目', '内容・メモ', '数量', '単位', '単価', '金額'] as const;
/** 元請けの内訳の列（A〜H）。 */
export const CONTRACT_HEADERS = ['区分', '名称', '規格・仕様', '数量', '単位', '単価', '金額', '工種（識別）'] as const;

/** 列見出しの行・入力の始まりの行（1 始まり）。 */
export const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;

/** 工種の欄の「現場全体」（材料・リース・その他）。 */
export const SITE_WIDE_LABEL = '（現場全体）';
/** 施工者の欄の「自社」と「なし」（現場全体の行）。 */
export const OWN_LABEL = '自社';
export const NO_PERFORMER_LABEL = '—';
/** 識別の「経費」「減分」。 */
export const EXPENSE_LABEL = '経費';
export const REDUCTION_LABEL = '減分';

/** 選択肢のシートの列：A 工種（2 行目は「（現場全体）」、3 行目から工種）・B 施工者・C 項目・D 区分・E 識別。 */
export const CHOICE_HEADERS = ['工種', '施工者', '項目', '区分', '工種（識別）'] as const;
/** 選択肢の工種の欄の最後の行（工種は 300 件まで書ける）。 */
export const CHOICE_LAST_ROW = 302;

export const ITEM_LABELS: string[] = BUDGET_ITEMS.map((i) => BUDGET_ITEM_LABEL[i]);
export const SECTION_LABELS: string[] = CONTRACT_SECTIONS.map((s) => CONTRACT_SECTION_LABEL[s]);

/** 比較用の正規化：NFKC → 空白をすべて除く。 */
export function normalizeName(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).normalize('NFKC').replace(/\s+/g, '');
}

/** `現場名_実行予算と内訳_YYYYMMDD.xlsx`、空の雛形は `現場名_実行予算と内訳_雛形.xlsx`。 */
export function budgetTemplateFileName(siteName: string, mode: 'empty' | 'current', today: string): string {
  const when = mode === 'empty' ? '雛形' : today.replaceAll('-', '');
  return `${fileNameStem(siteName)}_実行予算と内訳_${when}.xlsx`;
}
