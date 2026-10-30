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

function isSaveInput(v: unknown, siteId: string, date: string): v is SaveInput {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.siteId === siteId &&
    o.date === date &&
    Array.isArray(o.lines) &&
    typeof o.common === 'object' &&
    o.common !== null &&
    typeof o.issuesText === 'string' &&
    typeof o.notesText === 'string'
  );
}

export function loadDraft(siteId: string, date: string): SaveInput | null {
  try {
    const raw = window.localStorage.getItem(key(siteId, date));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSaveInput(parsed, siteId, date)) return null;
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
