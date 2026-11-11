// 帳票のファイル名に使う現場名（純関数）。

const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/** ファイル名に使う現場名。禁止文字（/ \ : * ? " < > |）と制御文字は _、前後の空白は除き、空なら「現場」。 */
export function fileNameStem(siteName: string): string {
  return siteName.trim().replace(FORBIDDEN, '_').trim() || '現場';
}
