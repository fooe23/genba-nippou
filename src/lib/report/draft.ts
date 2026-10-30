import type { SaveInput } from '@/lib/report/schema';

// 未保存の入力を端末（localStorage）に残す。プライベートモード等で使えない場合は何もしない。

function key(siteId: string, date: string): string {
  return `gn_draft:${siteId}:${date}`;
}

export function saveDraft(siteId: string, date: string, data: SaveInput): void {
  try {
    window.localStorage.setItem(key(siteId, date), JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
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

export function loadDraft(siteId: string, date: string): SaveInput | null {
  try {
    const raw = window.localStorage.getItem(key(siteId, date));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidDraft(parsed, siteId, date)) {
      // 読めない下書きは破棄扱い（残しておくと毎回復元を促してしまう）。
      clearDraft(siteId, date);
      return null;
    }
    // savedAt は保存時刻のメタ情報なので取り除く。
    const { savedAt: _savedAt, ...data } = parsed as SaveInput & { savedAt?: string };
    void _savedAt;
    return data;
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
