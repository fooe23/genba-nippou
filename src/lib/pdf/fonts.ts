import path from 'node:path';
import { Font } from '@react-pdf/renderer';

// PDF のフォント（Noto Sans JP の Regular・Bold。public/fonts/ に同梱、ライセンスは public/fonts/OFL.txt）。
// サーバー（Node）で読むので CDN は使わない。Vercel では next.config.ts の outputFileTracingIncludes で関数に含める。

export const PDF_FONT = 'NotoSansJP';

let registered = false;

/**
 * 改行の位置。日本語は語の間に空白が無いので、1 文字ずつに分け、各文字の後に '' を挟む。textkit は '' を幅 0 の
 * 区切り（glue）として扱うため、どの文字の間でも改行でき、ハイフン（-）は付かない。
 * （[word] のままだと、収まらない長い語を途中で切って「-」を足してしまう。textkit は文字の種類（漢字・かな）ごとに
 * 語を分けて渡すので、「その日の」の「日」のような 1 文字の語にも '' を付ける。付けないと次の語との間が
 * ハイフンつきの改行位置になる。）空白だけの語はそのまま。
 */
export function cjkBreaks(word: string): string[] {
  if (word.trim() === '') return [word];
  return Array.from(word).flatMap((c) => [c, '']);
}

/** フォントを 1 回だけ登録する。ハイフネーションはせず、文字の間で改行する（cjkBreaks）。 */
export function registerPdfFonts(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), 'public/fonts');
  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: path.join(dir, 'NotoSansJP-Regular.otf'), fontWeight: 400 },
      { src: path.join(dir, 'NotoSansJP-Bold.otf'), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(cjkBreaks);
  registered = true;
}
