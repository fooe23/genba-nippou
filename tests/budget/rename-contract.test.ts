import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 「元請けの内訳」は「受注の内訳」に名前を変えた（利用者 2026-11-10。設計書 §6）。前の名前は、Excel の取り込みで前の雛形の
// シート名を読むための template-format.ts の定数と、それを読む parse-template.ts の注記だけに残す。

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('「受注の内訳」への名前の変更', () => {
  it('src に「元請けの内訳」が残っていない（取り込みの前の名前を除く）', () => {
    const allowed = ['src/lib/budget/template-format.ts', 'src/lib/budget/parse-template.ts'];
    const left = files(join(process.cwd(), 'src'))
      .filter((p) => /\.(ts|tsx|md)$/.test(p))
      .map((p) => p.slice(process.cwd().length + 1))
      .filter((p) => !allowed.includes(p) && readFileSync(p, 'utf8').includes('元請けの内訳'));
    expect(left).toEqual([]);
  });
});
