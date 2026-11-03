import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import type { ExportPayload } from '@/lib/export/types';

// payload を V34 雛形に書いた xlsm を作る（Python の fill_workbook を呼ぶ）。
// - Vercel（または GN_EXPORT_FILL_URL があるとき）：Python 関数 api/export/fill.py に POST する。
// - ローカル：python3 python/run_fill.py を起動し、stdin に JSON を渡して stdout を受け取る。
// Next・Supabase には依存しない（spawn と fetch はテストで差し替える）。

const TEMPLATE = 'templates/現場管理台帳_V34_原本.xlsm';
const RUNNER = 'python/run_fill.py';

/** 出力に失敗したとき。code は機械向け、message は利用者向けの日本語。 */
export class FillError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FillError';
    this.code = code;
  }
}

/** child_process.spawn のうち、ここで使う部分。 */
export interface ChildLike {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
}
export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildLike;

export interface FillDeps {
  env: Record<string, string | undefined>;
  spawn: SpawnFn;
  fetch: typeof fetch;
  /** リポジトリのルート（ローカルで run_fill.py と雛形を探す場所）。 */
  cwd: string;
}

const defaultDeps = (): FillDeps => ({
  env: process.env,
  spawn: (command, args, options) => nodeSpawn(command, args, { cwd: options.cwd, stdio: 'pipe' }),
  fetch: globalThis.fetch,
  cwd: process.cwd(),
});

/** 失敗の本文（{"code","message"}）を読む。読めなければ null。 */
function parseErrorJson(text: string): { code: string; message: string } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && 'code' in v && 'message' in v && typeof v.code === 'string' && typeof v.message === 'string') {
      return { code: v.code, message: v.message };
    }
  } catch {
    // JSON でない
  }
  return null;
}

export async function fillWorkbook(payload: ExportPayload, deps: Partial<FillDeps> = {}): Promise<Buffer> {
  const d = { ...defaultDeps(), ...deps };
  if (d.env.VERCEL || d.env.GN_EXPORT_FILL_URL) return fillRemote(payload, d);
  return fillLocal(payload, d);
}

// ─── Vercel の Python 関数 ───

async function fillRemote(payload: ExportPayload, d: FillDeps): Promise<Buffer> {
  const secret = d.env.GN_EXPORT_SECRET;
  const host = d.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = d.env.GN_EXPORT_FILL_URL || (host ? `https://${host}/api/export/fill` : '');
  if (!secret || !url) {
    throw new FillError('not_configured', 'Excel 出力の設定（GN_EXPORT_SECRET・送り先）がありません。管理者に連絡してください');
  }

  let res: Response;
  try {
    res = await d.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Export-Secret': secret },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch (e) {
    console.error('[fillWorkbook] fetch', e);
    throw new FillError('fill_unreachable', 'Excel を作る処理につながりませんでした。時間をおいてやり直してください');
  }
  if (!res.ok) {
    const err = parseErrorJson(await res.text().catch(() => ''));
    if (err) throw new FillError(err.code, err.message);
    throw new FillError('fill_failed', `Excel の作成に失敗しました（${res.status}）`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0) throw new FillError('fill_failed', 'Excel の作成に失敗しました（空の応答）');
  return data;
}

// ─── ローカル（python3） ───

function fillLocal(payload: ExportPayload, d: FillDeps): Promise<Buffer> {
  const input = JSON.stringify({ template: path.join(d.cwd, TEMPLATE), payload });
  return new Promise<Buffer>((resolve, reject) => {
    let child: ChildLike;
    try {
      child = d.spawn('python3', [path.join(d.cwd, RUNNER)], { cwd: d.cwd });
    } catch (e) {
      console.error('[fillWorkbook] spawn', e);
      reject(new FillError('python_unavailable', 'Excel を作る Python（python3）を起動できませんでした'));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const fail = (e: FillError) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };

    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e) => {
      console.error('[fillWorkbook] python3', e);
      fail(new FillError('python_unavailable', 'Excel を作る Python（python3）を起動できませんでした'));
    });
    child.on('close', (code) => {
      if (settled) return;
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0 && stdout.length > 0) {
        settled = true;
        resolve(stdout);
        return;
      }
      // run_fill.py は失敗を stderr の最後の行に JSON で書く
      const lastLine = stderr.trim().split('\n').pop() ?? '';
      const parsed = parseErrorJson(lastLine);
      if (parsed) {
        fail(new FillError(parsed.code, parsed.message));
        return;
      }
      console.error('[fillWorkbook] python3 exit', code, stderr.slice(0, 2000));
      fail(new FillError('internal_error', 'Excel の作成に失敗しました'));
    });
    // Python が先に終わったとき（EPIPE）は close の側で扱う
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}
