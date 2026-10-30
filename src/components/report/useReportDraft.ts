'use client';

import { useEffect, useRef, useState } from 'react';
import { clearDraft, loadDraft, saveDraft } from '@/lib/report/draft';
import type { SaveInput } from '@/lib/report/schema';

const INTERVAL_MS = 2000;

/**
 * 端末への下書き自動保存。
 * - 開いた時に下書きがあり、サーバーの内容（baseline）と違えば pending に入れる（復元／破棄を選ばせる）。
 * - 選ぶまでは自動保存しない（下書きを上書きしないため）。
 * - 以降は2秒ごとに、変更があれば保存。サーバーと同じ内容に戻れば下書きを消す。画面を離れる時にも保存する。
 */
export function useReportDraft({
  siteId,
  date,
  json,
  baseline,
  normalize,
  enabled,
}: {
  siteId: string;
  date: string;
  json: string;
  baseline: string;
  normalize: (d: SaveInput) => string;
  enabled: boolean;
}) {
  const [pending, setPending] = useState<SaveInput | null>(null);
  const [checked, setChecked] = useState(false);
  const latest = useRef(json);
  const base = useRef(baseline);
  const written = useRef(json);

  useEffect(() => {
    latest.current = json;
    base.current = baseline;
  }, [json, baseline]);

  // 初回だけ: 下書きの有無を確認する（localStorage はサーバー描画では読めないため effect で行う）。
  useEffect(() => {
    const d = enabled ? loadDraft(siteId, date) : null;
    const differs = d !== null && normalize(d) !== base.current;
    if (d !== null && !differs) clearDraft(siteId, date);
    setPending(differs ? d : null);
    setChecked(true);
    // マウント時に一度だけ確認する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = enabled && checked && pending === null;

  useEffect(() => {
    if (!active) return;
    const flush = () => {
      const cur = latest.current;
      if (cur === written.current) return;
      if (cur === base.current) clearDraft(siteId, date);
      else saveDraft(siteId, date, JSON.parse(cur) as SaveInput);
      written.current = cur;
    };
    const id = window.setInterval(flush, INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [active, siteId, date]);

  return {
    pending,
    /** 復元を選んだ: 下書きを返し、以降は自動保存を再開する。 */
    takePending(): SaveInput | null {
      const d = pending;
      setPending(null);
      return d;
    },
    /** 破棄を選んだ／サーバーに保存できた: 下書きを消す。 */
    discard(saved?: string) {
      clearDraft(siteId, date);
      if (saved !== undefined) written.current = saved;
      setPending(null);
    },
  };
}
