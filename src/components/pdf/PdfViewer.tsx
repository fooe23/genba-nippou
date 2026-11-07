'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { fileNameFromDisposition, inlineHref } from '@/lib/pdf-viewer';

// アプリの中の PDF ビューアー（/pdf の本体）。
// - 上の帯：「← 戻る」（back があればそこへ、なければ履歴を 1 つ戻る、履歴が無ければホーム）、見出し、「保存」（disposition=attachment）、
//   「共有」（navigator.canShare({ files }) が使える端末だけ。iPhone は「共有」→「ファイルに保存」で保存できる）。
// - PDF は pdf.js でページごとに canvas に描く（iPhone の Safari は iframe だと 1 ページ目しか出ない）。横幅に合わせ、
//   devicePixelRatio で細かく描く。画面に近いページだけ描き、遠くなったページは消して、メモリを抑える。
// - pdf.js が読み込めない・PDF を開けないときは、iframe で開いて「保存」を案内する。
// PDF は 1 回だけ取りに行き、そのデータを表示と「共有」に使う（共有はボタンを押した直後に呼ばないと iPhone で断られる）。

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** pdf.js を読み込む（1 回だけ）。古い iPhone でも動くよう legacy 版。worker は同じサイトから配る。 */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
        return pdfjs;
      })
      .catch((e: unknown) => {
        pdfjsPromise = null;
        throw e;
      });
  }
  return pdfjsPromise;
}

/** API のエラー（{ ok: false, error }）を日本語の文にする。 */
async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return 'ログインが切れました。ログインし直してください。';
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // JSON でなければ下の文
  }
  if (res.status === 403) return 'この PDF を開く権限がありません。';
  if (res.status === 404) return 'PDF が見つかりません。';
  return `PDF を開けませんでした（${res.status}）。時間をおいてやり直してください。`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; doc: PDFDocumentProxy; pages: PDFPageProxy[] }
  | { kind: 'fallback' };

const barButton =
  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-3 text-base font-bold disabled:opacity-50';

export function PdfViewer({ src, downloadHref, title, back }: { src: string; downloadHref: string; title: string; back: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // PDF を取りに行き、pdf.js で開く
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      let res: Response;
      try {
        res = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'PDF を読み込めませんでした。通信状況を確認して、もう一度お試しください。' });
        return;
      }
      if (!res.ok) {
        const message = await errorMessage(res);
        if (!cancelled) setState({ kind: 'error', message });
        return;
      }
      let blob: Blob;
      try {
        blob = await res.blob();
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'PDF を読み込めませんでした。通信状況を確認して、もう一度お試しください。' });
        return;
      }
      if (cancelled) return;
      const name = fileNameFromDisposition(res.headers.get('Content-Disposition'), 'document.pdf');
      const pdfFile = new File([blob], name, { type: 'application/pdf' });
      setFile(pdfFile);
      try {
        setCanShare(typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [pdfFile] }));
      } catch {
        setCanShare(false);
      }

      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        doc = await pdfjs.getDocument({ data }).promise;
        const pages: PDFPageProxy[] = [];
        for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
        if (cancelled) return;
        setState({ kind: 'ready', doc, pages });
      } catch (e) {
        console.error('[pdf-viewer] pdf.js', e);
        if (!cancelled) setState({ kind: 'fallback' });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [src, attempt]);

  // 横幅（回転・画面の大きさの変化に合わせて描き直す）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const goBack = useCallback(() => {
    if (back) router.replace(back);
    else if (window.history.length > 1) router.back();
    else router.replace('/');
  }, [back, router]);

  const share = useCallback(async () => {
    if (!file) return;
    setActionError(null);
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      // 共有の画面を閉じただけ（AbortError）はエラーにしない
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('[pdf-viewer] share', e);
      setActionError('共有できませんでした。「保存」をお試しください。');
    }
  }, [file]);

  const fallbackSrc = inlineHref(src) ?? src;

  return (
    <div className="flex min-h-dvh flex-col bg-gray-200 dark:bg-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-300 bg-white pt-[env(safe-area-inset-top)] dark:border-gray-700 dark:bg-gray-950">
        <div className="flex items-center gap-1 px-2 py-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))]">
          <button type="button" onClick={goBack} className={`${barButton} text-blue-700 dark:text-blue-400`}>
            ← 戻る
          </button>
          <h1 className="min-w-0 flex-1 truncate px-1 text-center text-sm font-bold sm:text-base">{title}</h1>
          <a href={downloadHref} download className={`${barButton} border border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400`}>
            保存
          </a>
          {canShare && (
            <button type="button" onClick={() => void share()} className={`${barButton} bg-blue-700 text-white`}>
              共有
            </button>
          )}
        </div>
        {actionError && (
          <p role="alert" className="border-t border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-50">
            {actionError}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div ref={containerRef} className="w-full">
          {state.kind === 'loading' && (
            <p role="status" className="p-6 text-center text-gray-700 dark:text-gray-300">
              PDF を読み込んでいます…
            </p>
          )}
          {state.kind === 'error' && (
            <div className="space-y-3 p-2">
              <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ kind: 'loading' });
                  setAttempt((n) => n + 1);
                }}
                className={`${barButton} border border-gray-400 dark:border-gray-600`}
              >
                もう一度読み込む
              </button>
            </div>
          )}
          {state.kind === 'fallback' && (
            <div className="space-y-2">
              <p role="status" className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-50">
                この端末では PDF をきれいに表示できませんでした。下に開いた PDF が途中までしか見えないときは、上の「保存」で端末に保存してから開いてください。
              </p>
              <iframe src={fallbackSrc} title={title} className="h-[75dvh] w-full rounded border border-gray-300 bg-white dark:border-gray-700" />
            </div>
          )}
          {state.kind === 'ready' && (
            <div className="flex flex-col items-center gap-3">
              {state.pages.map((page) => (
                <PdfPageCanvas key={page.pageNumber} page={page} width={width} total={state.pages.length} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** canvas の画素の上限（iPhone の Safari は大きすぎる canvas を描かない）。 */
const MAX_CANVAS_PIXELS = 8_000_000;

/** 1 ページ分。画面に近づいたら描き、遠くなったら消す。 */
function PdfPageCanvas({ page, width, total }: { page: PDFPageProxy; width: number; total: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(page.pageNumber <= 2);
  const [failed, setFailed] = useState(false);
  const base = page.getViewport({ scale: 1 });
  const cssWidth = Math.max(1, width);
  const cssHeight = Math.round((cssWidth * base.height) / base.width);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    if (!near) {
      // 遠くなったページは画素を捨てる（メモリを抑える）
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = cssWidth / base.width;
    const viewport = page.getViewport({ scale });
    let ratio = Math.min(window.devicePixelRatio || 1, 3);
    if (viewport.width * viewport.height * ratio * ratio > MAX_CANVAS_PIXELS) {
      ratio = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    }
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    task.promise.then(
      () => setFailed(false),
      (e: unknown) => {
        if (e instanceof Error && e.name === 'RenderingCancelledException') return;
        console.error('[pdf-viewer] render', e);
        setFailed(true);
      },
    );
    return () => task.cancel();
  }, [page, near, width, cssWidth, base.width]);

  return (
    <div
      ref={wrapRef}
      className="relative bg-white shadow"
      style={{ width: cssWidth, height: cssHeight }}
      aria-label={`${page.pageNumber} / ${total} ページ`}
      role="img"
    >
      <canvas ref={canvasRef} style={{ width: cssWidth, height: cssHeight }} className="block" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-800">
          このページを表示できませんでした。「保存」で端末に保存して開いてください。
        </p>
      )}
    </div>
  );
}
