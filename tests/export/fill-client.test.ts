import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FillError, fillWorkbook, type SpawnFn } from '@/lib/export/fill-client';
import type { ExportPayload } from '@/lib/export/types';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAYLOAD = JSON.parse(
  readFileSync(new URL('../../python/tests/fixtures/payload_days.json', import.meta.url), 'utf8'),
) as ExportPayload;

// ─── spawn の代わり（python3 を動かさずに stdout・stderr・終了コードを返す） ───

interface FakeRun {
  stdout?: Buffer | string;
  stderr?: string;
  exitCode?: number | null;
  /** 起動に失敗したとき（python3 が無いなど）。 */
  error?: Error;
}

function fakeSpawn(run: FakeRun) {
  const calls: { command: string; args: string[]; cwd: string; stdin: string }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { command, args, cwd: options.cwd, stdin: '' };
    calls.push(call);
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    child.stdin.on('finish', () => {
      call.stdin = Buffer.concat(chunks).toString('utf8');
      setImmediate(() => {
        if (run.error) {
          child.emit('error', run.error);
          return;
        }
        if (run.stdout !== undefined) child.stdout.write(run.stdout);
        if (run.stderr !== undefined) child.stderr.write(run.stderr);
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => child.emit('close', run.exitCode ?? 0));
      });
    });
    return child;
  };
  return { spawn, calls };
}

const LOCAL_ENV = {};

// 想定外の失敗は console.error に残す（ここでは出力を汚さないよう黙らせる）。
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fillWorkbook（ローカル：python3 python/run_fill.py）', () => {
  it('雛形のパスと payload を stdin に渡し、stdout を返す', async () => {
    const { spawn, calls } = fakeSpawn({ stdout: Buffer.from('PK\u0003\u0004xlsm') });
    const out = await fillWorkbook(PAYLOAD, { env: LOCAL_ENV, spawn, cwd: '/repo' });
    expect(out.toString('latin1')).toBe('PK\u0003\u0004xlsm');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('python3');
    expect(calls[0].args).toEqual(['/repo/python/run_fill.py']);
    expect(calls[0].cwd).toBe('/repo');
    expect(JSON.parse(calls[0].stdin)).toEqual({ template: '/repo/templates/現場管理台帳_V34_原本.xlsm', payload: PAYLOAD });
  });

  it('失敗（exit 1）は stderr の JSON 1 行を FillError にする', async () => {
    const { spawn } = fakeSpawn({
      exitCode: 1,
      stderr: 'Traceback は出さない\n{"code": "invalid_payload", "message": "日報の回目（3回目）が重複しています"}\n',
    });
    const err = await fillWorkbook(PAYLOAD, { env: LOCAL_ENV, spawn, cwd: '/repo' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FillError);
    expect(err).toMatchObject({ code: 'invalid_payload', message: '日報の回目（3回目）が重複しています' });
  });

  it('stderr が JSON でなければ internal_error', async () => {
    const { spawn } = fakeSpawn({ exitCode: 1, stderr: 'ModuleNotFoundError: No module named openpyxl' });
    await expect(fillWorkbook(PAYLOAD, { env: LOCAL_ENV, spawn, cwd: '/repo' })).rejects.toMatchObject({
      code: 'internal_error',
      message: 'Excel の作成に失敗しました',
    });
  });

  it('exit 0 でも stdout が空なら失敗にする', async () => {
    const { spawn } = fakeSpawn({ exitCode: 0, stdout: '' });
    await expect(fillWorkbook(PAYLOAD, { env: LOCAL_ENV, spawn, cwd: '/repo' })).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('python3 を起動できなければ python_unavailable', async () => {
    const { spawn } = fakeSpawn({ error: Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' }) });
    await expect(fillWorkbook(PAYLOAD, { env: LOCAL_ENV, spawn, cwd: '/repo' })).rejects.toMatchObject({
      code: 'python_unavailable',
      message: 'Excel を作る Python（python3）を起動できませんでした',
    });
  });
});

// ─── 本番（Vercel の Python 関数に POST） ───

function okResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/vnd.ms-excel.sheet.macroEnabled.12' } });
}

describe('fillWorkbook（Vercel：/api/export/fill に POST）', () => {
  const VERCEL_ENV = { VERCEL: '1', GN_EXPORT_SECRET: 's3cret', VERCEL_PROJECT_PRODUCTION_URL: 'genba.example.vercel.app' };

  it('本番 URL に秘密のヘッダーと payload を送り、本文を返す', async () => {
    const fetch = vi.fn(async () => okResponse('PKdata'));
    const spawn = vi.fn() as unknown as SpawnFn;
    const out = await fillWorkbook(PAYLOAD, { env: VERCEL_ENV, fetch, spawn });
    expect(out.toString('latin1')).toBe('PKdata');
    expect(spawn).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://genba.example.vercel.app/api/export/fill');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Export-Secret': 's3cret' });
    expect(JSON.parse(init.body as string)).toEqual(PAYLOAD);
  });

  it('GN_EXPORT_FILL_URL があればそちらへ（VERCEL が無くても）', async () => {
    const fetch = vi.fn(async () => okResponse('PK'));
    await fillWorkbook(PAYLOAD, { env: { GN_EXPORT_FILL_URL: 'http://127.0.0.1:9000/fill', GN_EXPORT_SECRET: 'x' }, fetch });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:9000/fill');
  });

  it('関数の 400/500 は本文の {code, message} を FillError にする', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ code: 'template_not_found', message: '雛形ファイルが見つかりません' }), { status: 500 }),
    );
    await expect(fillWorkbook(PAYLOAD, { env: VERCEL_ENV, fetch })).rejects.toMatchObject({
      code: 'template_not_found',
      message: '雛形ファイルが見つかりません',
    });
  });

  it('本文が JSON でない失敗は fill_failed', async () => {
    const fetch = vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = await fillWorkbook(PAYLOAD, { env: VERCEL_ENV, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FillError);
    expect(err).toMatchObject({ code: 'fill_failed', message: 'Excel の作成に失敗しました（502）' });
  });

  it('つながらなければ fill_unreachable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fillWorkbook(PAYLOAD, { env: VERCEL_ENV, fetch })).rejects.toMatchObject({ code: 'fill_unreachable' });
  });

  it('GN_EXPORT_SECRET か送り先が無ければ送らずに not_configured', async () => {
    const fetch = vi.fn(async () => okResponse('PK'));
    await expect(fillWorkbook(PAYLOAD, { env: { VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'a.vercel.app' }, fetch })).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(fillWorkbook(PAYLOAD, { env: { VERCEL: '1', GN_EXPORT_SECRET: 's' }, fetch })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── 本物の python3 で通す（python3 と openpyxl があるときだけ） ───

const hasPython = spawnSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasPython)('fillWorkbook（本物の python3）', () => {
  it('fixture の payload から xlsm（zip）を作る', async () => {
    const out = await fillWorkbook(PAYLOAD, { env: {}, cwd: ROOT });
    expect(out.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(out.length).toBeGreaterThan(10_000);
  }, 60_000);

  it('雛形の形式に合わない payload は Python の code・message を返す', async () => {
    const bad = { ...PAYLOAD, days: [{ ...PAYLOAD.days[0], index: 99 }] };
    await expect(fillWorkbook(bad, { env: {}, cwd: ROOT })).rejects.toMatchObject({ code: 'invalid_payload' });
  }, 60_000);
});
