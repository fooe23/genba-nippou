import path from 'node:path';
import { Font } from '@react-pdf/renderer';

// PDF のフォント（Noto Sans JP の Regular・Bold。public/fonts/ に同梱、ライセンスは public/fonts/OFL.txt）。
// サーバー（Node）で読むので CDN は使わない。Vercel では next.config.ts の outputFileTracingIncludes で関数に含める。

export const PDF_FONT = 'NotoSansJP';

let registered = false;

/** 行頭に来てはいけない文字（閉じ括弧・句読点など）。この文字の前では改行しない（禁則）。 */
const NO_BREAK_BEFORE = new Set(Array.from('。、）」』】〕，．：；！？'));
/** 行末に来てはいけない文字（開き括弧）。この文字の後では改行しない（禁則）。 */
const NO_BREAK_AFTER = new Set(Array.from('（「『【〔'));

/**
 * 改行の位置。日本語は語の間に空白が無いので、1 文字ずつに分け、各文字の後に '' を挟む。textkit は '' を幅 0 の
 * 区切り（glue）として扱うため、どの文字の間でも改行でき、ハイフン（-）は付かない。
 * （[word] のままだと、収まらない長い語を途中で切って「-」を足してしまう。textkit は文字の種類（漢字・かな）ごとに
 * 語を分けて渡すので、「その日の」の「日」のような 1 文字の語にも '' を付ける。付けないと次の語との間が
 * ハイフンつきの改行位置になる。）空白だけの語はそのまま。
 *
 * 禁則：閉じ括弧・句読点（NO_BREAK_BEFORE）はその前の文字と、開き括弧（NO_BREAK_AFTER）はその次の文字と 1 つの
 * かたまりにする（間に '' を挟まない。挟まずに別の要素にするとハイフンつきの改行位置になるため、文字列ごとつなぐ）。
 * 例：「依頼。」→ ['依', '', '頼。', '']、「（手入力）」→ ['（手', '', '入', '', '力）', '']。
 * 語（textkit が渡す単位）の境目はこの関数からは見えないので、語の末尾の開き括弧・語の先頭の閉じ括弧は禁則にできない
 * （句読点・括弧は前の文字と同じ語に入るため、語の先頭の閉じ括弧はまず無い）。
 */
export function cjkBreaks(word: string): string[] {
  if (word.trim() === '') return [word];
  const parts: string[] = [];
  let chunk = '';
  let prev = '';
  for (const c of Array.from(word)) {
    if (chunk !== '' && !NO_BREAK_BEFORE.has(c) && !NO_BREAK_AFTER.has(prev)) {
      parts.push(chunk, '');
      chunk = '';
    }
    chunk += c;
    prev = c;
  }
  parts.push(chunk, '');
  return parts;
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
