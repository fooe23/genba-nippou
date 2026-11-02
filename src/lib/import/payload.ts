import type { ImportPayload, ImportPreview, PreviewRow } from './types';

/** 送れる行（新規・更新）。変更なし・エラーは送らない。 */
export function isSendable(r: { status: PreviewRow<unknown>['status'] }): boolean {
  return r.status === 'new' || r.status === 'updated';
}

function pick<P>(rows: PreviewRow<P>[], selected: ReadonlySet<string>): P[] {
  return rows.filter((r) => isSendable(r) && selected.has(r.key)).map((r) => r.payload);
}

/** RPC gn_import_masters に送る形。選択された新規・更新の行だけ（変更なし・エラーは送らない）。 */
export function toPayload(preview: ImportPreview, selectedKeys: ReadonlySet<string> | readonly string[]): ImportPayload {
  const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
  return {
    workers: pick(preview.workers, selected),
    suppliers: pick(preview.suppliers, selected),
    vehicles: pick(preview.vehicles, selected),
    lease_items: pick(preview.leaseItems, selected),
  };
}

/** 新規・更新の行のキー（確認画面のチェックの既定＝すべて ON）。 */
export function selectableKeys(preview: ImportPreview): string[] {
  return [...preview.workers, ...preview.suppliers, ...preview.vehicles, ...preview.leaseItems]
    .filter(isSendable)
    .map((r) => r.key);
}
