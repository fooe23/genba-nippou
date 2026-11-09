import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { SaveInput } from '@/lib/report/schema';

// 未保存の入力を端末（localStorage）に残す。プライベートモード等で使えない場合は何もしない。

function key(siteId: string, date: string): string {
  return `gn_draft:${siteId}:${date}`;
}

/**
 * serverUpdatedAt は、下書きのもとになったサーバーの日報の updated_at（未保存の日報なら null）。
 * 開き直したときにサーバーの方が新しければ、復元すると上書きになることを知らせるのに使う。
 */
export function saveDraft(siteId: string, date: string, data: SaveInput, serverUpdatedAt: string | null): void {
  try {
    window.localStorage.setItem(
      key(siteId, date),
      JSON.stringify({ ...data, savedAt: new Date().toISOString(), serverUpdatedAt }),
    );
  } catch {
    // 保存できなくても入力は続けられる。
  }
}

const KINDS = new Set(['labor', 'fuel', 'lease', 'cash', 'credit', 'work']);

/** 下書きの形のゆるい確認（古い形式の下書きで表が壊れないように）。各行は正しい kind を持ち、作業員の行は time を持つこと。 */
export function isValidDraft(v: unknown, siteId: string, date: string): v is SaveInput {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (
    o.siteId !== siteId ||
    o.date !== date ||
    !Array.isArray(o.lines) ||
    typeof o.common !== 'object' ||
    o.common === null ||
    typeof o.issuesText !== 'string' ||
    typeof o.notesText !== 'string'
  ) {
    return false;
  }
  return o.lines.every((l: unknown) => {
    if (typeof l !== 'object' || l === null) return false;
    const line = l as Record<string, unknown>;
    if (typeof line.kind !== 'string' || !KINDS.has(line.kind)) return false;
    return line.kind !== 'labor' || (typeof line.time === 'object' && line.time !== null);
  });
}

/** 作業内容の行に無い区分・指示の項目だけを既定値で足す（EMPTY_WORK_CHANGE の並びで末尾に）。 */
function missingWorkChange(l: object): Partial<typeof EMPTY_WORK_CHANGE> {
  return Object.fromEntries(Object.entries(EMPTY_WORK_CHANGE).filter(([k]) => (l as Record<string, unknown>)[k] === undefined));
}

/**
 * 古い形式の下書きを今の形にそろえる。作業員の行に残業単価（overtimeRate）が無ければ null（標準の計算式）を入れる。
 * 作業内容の行に区分・指示の項目が無ければ既定（契約内・指示なし）を、実行予算の工種が無ければ null（選んでいない）を入れる。
 * 項目は末尾に足す（サーバーから読んだ行と JSON の並びをそろえ、同じ内容なら復元を促さないため）。
 */
export function upgradeDraft(data: SaveInput): SaveInput {
  return {
    ...data,
    lines: data.lines.map((l) => {
      if (l.kind === 'labor' && (l as { overtimeRate?: unknown }).overtimeRate === undefined) return { ...l, overtimeRate: null };
      if (l.kind === 'work') {
        const up = { ...l, ...missingWorkChange(l) };
        // 実行予算の工種（2026-11-15）が無い下書きは選んでいない（null）。サーバーから読んだ行と同じく issueId の後ろに足す。
        return (l as { siteTradeId?: unknown }).siteTradeId === undefined ? { ...up, siteTradeId: null } : up;
      }
      return l;
    }),
  };
}

export interface LoadedDraft {
  data: SaveInput;
  /** 下書きのもとになったサーバーの updated_at。古い形式の下書き・未保存の日報なら null。 */
  serverUpdatedAt: string | null;
}

/**
 * サーバーの日報が、下書きのもとになった版より新しいか（他の端末で保存された・後から作られた）。
 * どちらも PostgREST が返した文字列のまま比べる（同じ文字列なら同じ版）。
 */
export function isServerNewer(serverUpdatedAt: string | null, draftServerUpdatedAt: string | null): boolean {
  if (serverUpdatedAt === null) return false;
  if (draftServerUpdatedAt === null) return true;
  if (serverUpdatedAt === draftServerUpdatedAt) return false;
  const s = Date.parse(serverUpdatedAt);
  const d = Date.parse(draftServerUpdatedAt);
  if (Number.isNaN(s) || Number.isNaN(d)) return true;
  // 文字列が違い、ミリ秒まで同じならマイクロ秒の差なので新しいとみなす
  return s >= d;
}

export function loadDraft(siteId: string, date: string): LoadedDraft | null {
  try {
    const raw = window.localStorage.getItem(key(siteId, date));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidDraft(parsed, siteId, date)) {
      // 読めない下書きは破棄扱い（残しておくと毎回復元を促してしまう）。
      clearDraft(siteId, date);
      return null;
    }
    // savedAt・serverUpdatedAt はメタ情報なので取り除く。
    const { savedAt: _savedAt, serverUpdatedAt, ...data } = parsed as SaveInput & { savedAt?: string; serverUpdatedAt?: unknown };
    void _savedAt;
    return { data: upgradeDraft(data), serverUpdatedAt: typeof serverUpdatedAt === 'string' ? serverUpdatedAt : null };
  } catch {
    return null;
  }
}

export function clearDraft(siteId: string, date: string): void {
  try {
    window.localStorage.removeItem(key(siteId, date));
  } catch {
    // 何もしない。
  }
}
