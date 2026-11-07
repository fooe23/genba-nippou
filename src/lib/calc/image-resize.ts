// 写真を縮める大きさの計算と、添付の印（見積書あり／なし・写真 N・リンク N）の数え方。画面とテストで使う純関数。

/** 写真の長い辺の上限（px）。 */
export const PHOTO_MAX_LONG = 1600;

/**
 * 長い辺が maxLong 以下になるように縦横比を保って縮めた大きさ（整数）。小さい写真は拡大しない（そのまま）。
 * 短い辺は 1 以上。幅・高さが正の数でなければ、そのまま返す（呼び出し側で読めない写真として扱う）。
 */
export function fitWithin(width: number, height: number, maxLong = PHOTO_MAX_LONG): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return { width, height };
  const long = Math.max(width, height);
  if (long <= maxLong) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxLong / long;
  if (width >= height) return { width: maxLong, height: Math.max(1, Math.round(height * scale)) };
  return { width: Math.max(1, Math.round(width * scale)), height: maxLong };
}

/** 添付の印。hasFile はファイル（見積書など）が 1 つ以上あるか。 */
export interface AttachmentBadgeCounts {
  hasFile: boolean;
  photos: number;
  links: number;
}

/** 添付の一覧から印の数を数える。 */
export function attachmentBadgeCounts(list: readonly { kind: string }[]): AttachmentBadgeCounts {
  let files = 0;
  let photos = 0;
  let links = 0;
  for (const a of list) {
    if (a.kind === 'file') files += 1;
    else if (a.kind === 'photo') photos += 1;
    else if (a.kind === 'link') links += 1;
  }
  return { hasFile: files > 0, photos, links };
}
