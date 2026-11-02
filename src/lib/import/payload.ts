import type { ImportPayload, ImportPreview, PreviewRow } from './types';

function pick<P>(rows: PreviewRow<P>[], selected: ReadonlySet<string>): P[] {
  return rows.filter((r) => r.status !== 'unchanged' && selected.has(r.key)).map((r) => r.payload);
}

/** RPC gn_import_masters に送る形。選択された新規・更新の行だけ（変更なしは送らない）。 */
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
    .filter((r) => r.status !== 'unchanged')
    .map((r) => r.key);
}
