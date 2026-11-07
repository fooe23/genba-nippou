import { fitWithin, PHOTO_MAX_LONG } from '@/lib/calc/image-resize';

// 写真をブラウザで縮める（長い辺 1600px・JPEG 画質 0.8）。元の写真は送らない。
// スクリーンショット（PNG）なども JPEG にする。向きは createImageBitmap の imageOrientation: 'from-image'
// で EXIF に合わせて正す（使えないブラウザは <img> で読む。いまのブラウザは <img> も EXIF の向きに従う）。
// HEIC（iPhone）はブラウザが読めればそのまま縮める（iPhone の Safari は読める。ファイル選択で JPEG に変わることも多い）。

export const PHOTO_UNREADABLE_MESSAGE = 'この形式の写真は付けられません。スクリーンショットか JPEG で付けてください';
export const PHOTO_QUALITY = 0.8;

type Source = { image: CanvasImageSource; width: number; height: number; close: () => void };

async function viaBitmap(file: Blob): Promise<Source> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
}

function viaImageElement(file: Blob): Promise<Source> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () =>
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_unreadable'));
    };
    img.src = url;
  });
}

async function load(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await viaBitmap(file);
    } catch {
      // 古いブラウザ（imageOrientation が使えない）や読めない形式は <img> で試す
    }
  }
  return viaImageElement(file);
}

/** 写真を縮めた JPEG にする。読めない形式なら PHOTO_UNREADABLE_MESSAGE の Error を投げる。 */
export async function compressPhoto(file: Blob, maxLong = PHOTO_MAX_LONG): Promise<Blob> {
  let src: Source;
  try {
    src = await load(file);
  } catch {
    throw new Error(PHOTO_UNREADABLE_MESSAGE);
  }
  try {
    if (!(src.width > 0) || !(src.height > 0)) throw new Error(PHOTO_UNREADABLE_MESSAGE);
    const size = fitWithin(src.width, src.height, maxLong);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(PHOTO_UNREADABLE_MESSAGE);
    // 透過のある PNG（スクリーンショットなど）は白地にする（JPEG は透過を持てず黒くなるため）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob || blob.size === 0) throw new Error(PHOTO_UNREADABLE_MESSAGE);
    return blob;
  } finally {
    src.close();
  }
}

/** 写真として扱うファイルか（画像の mime か、mime が空で写真の拡張子）。 */
export function isPhotoFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  if (file.type !== '') return false;
  return /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name);
}

/** 縮めた写真の名前（拡張子を .jpg に）。 */
export function photoName(original: string): string {
  const base = original.replace(/\.[^.]*$/, '').trim() || '写真';
  return `${base.slice(0, 95)}.jpg`;
}
