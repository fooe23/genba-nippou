// お客様用日報 PDF に載せる画像の小さな純関数（サーバーで Storage から読んだ写真・サインの中身を react-pdf に渡す前に使う）。

/** 画像の形式（先頭のバイトで見る）。react-pdf が載せられるのは JPEG と PNG だけ。それ以外は null。 */
export function imageFormat(data: Uint8Array): 'jpg' | 'png' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
    return 'png';
  return null;
}

/** items を同時に limit 件までで fn に通す（並びは items のまま）。 */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
