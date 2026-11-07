'use client';

import { useCallback, useEffect, useRef } from 'react';
import { isBlankDrawing, SIGNATURE_EMPTY_MESSAGE } from '@/lib/report/client-signature';

// 指（タッチ）・ペン・マウスでサインを書く欄（高さ 190px 以上。書き直す・保存のボタンは親が handleRef で呼ぶ）。pointer events で描き、白い背景の PNG にする。
// 画面の大きさ（向き）が変わったら、書いた線を描き直す（線は CSS の座標で覚えている）。
// 端末の画素密度（devicePixelRatio）に合わせて描くので、iPad・スマホでも線がぼやけない。

type Point = { x: number; y: number };

const LINE_WIDTH = 3;

export interface SignaturePadHandle {
  /** 書いた絵の PNG。空（ほとんど描いていない）なら { error }。 */
  toPng: () => Promise<{ blob: Blob } | { error: string }>;
  /** 書いた線を消す（書き直す）。 */
  clear: () => void;
}

interface Props {
  /** 書いた・消したときに呼ぶ（エラーの表示を消すなど）。 */
  onChange?: () => void;
  /** 親が PNG を取り出すための口。 */
  handleRef: React.RefObject<SignaturePadHandle | null>;
  disabled?: boolean;
}

export function SignaturePad({ onChange, handleRef, disabled }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<{ id: number; stroke: Point[] } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) drawStroke(ctx, s);
  }, []);

  useEffect(() => {
    redraw();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => {
    handleRef.current = {
      toPng: async () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || strokes.current.length === 0) return { error: SIGNATURE_EMPTY_MESSAGE };
        const dpr = window.devicePixelRatio || 1;
        // 点を 1 つ打っただけのような「ほとんど描いていない」ものも空とみなす（線の太さ × 画素密度で目安を変える）
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        if (isBlankDrawing(pixels, Math.round(60 * dpr * dpr))) return { error: SIGNATURE_EMPTY_MESSAGE };
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        return blob ? { blob } : { error: SIGNATURE_EMPTY_MESSAGE };
      },
      clear: () => {
        strokes.current = [];
        drawing.current = null;
        redraw();
        onChangeRef.current?.();
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, redraw]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || drawing.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke = [point(e)];
    drawing.current = { id: e.pointerId, stroke };
    strokes.current.push(stroke);
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) drawStroke(ctx, stroke);
    onChange?.();
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext('2d');
    // 速く動かしたときの途中の点も拾う（対応していないブラウザは今の点だけ）
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const r = e.currentTarget.getBoundingClientRect();
    const pts = events.length > 0 ? events.map((c) => ({ x: c.clientX - r.left, y: c.clientY - r.top })) : [point(e)];
    for (const p of pts) {
      const prev = d.stroke[d.stroke.length - 1];
      d.stroke.push(p);
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drawing.current?.id === e.pointerId) drawing.current = null;
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-[clamp(190px,45vh,320px)] w-full overflow-hidden rounded-lg border-2 border-slate-700 bg-white"
    >
      <canvas
        ref={canvasRef}
        aria-label="サインを書く欄"
        className="absolute inset-0 touch-none select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
      />
      <div aria-hidden className="pointer-events-none absolute right-4 bottom-10 left-4 border-b border-dashed border-slate-400" />
      <p aria-hidden className="pointer-events-none absolute bottom-3 left-4 text-xs text-slate-500">
        ここに指でサインしてください
      </p>
    </div>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Point[]) {
  if (s.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(s[0].x, s[0].y);
  if (s.length === 1) {
    // 点だけ（タップ）は小さな丸
    ctx.arc(s[0].x, s[0].y, LINE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    return;
  }
  for (const p of s.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}
