'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LONG_PRESS_MS, longPressProgress } from '@/lib/report/client-confirm';

// 長押しで動くボタン（お客様用の確認画面の「社内の画面に戻る」）。押している間、ボタンの中が左から塗られていき、
// durationMs（既定 1.5 秒）押し続けると onComplete を呼ぶ。途中で離すと取り消し（塗りも戻る）。
// キーボード：Enter・Space を押し続けても同じ（離すと取り消し）。クリック 1 回では動かない。

interface Props {
  onComplete: () => void;
  children: ReactNode;
  durationMs?: number;
  disabled?: boolean;
  className?: string;
  /** 画面読み上げ用の説明（長押しが要ること）。 */
  description?: string;
}

export function LongPressButton({ onComplete, children, durationMs = LONG_PRESS_MS, disabled, className = '', description }: Props) {
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // 押している間だけ、毎フレーム進み具合を更新する。離す（pressing が false）とループを止める。
  useEffect(() => {
    if (!pressing) return;
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const { progress: p, done } = longPressProgress(performance.now() - startedAt, durationMs);
      setProgress(p);
      if (done) {
        setPressing(false);
        onCompleteRef.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pressing, durationMs]);

  const begin = useCallback(() => {
    if (disabled) return;
    setProgress(0);
    setPressing(true);
  }, [disabled]);

  const cancel = useCallback(() => {
    setPressing(false);
    setProgress(0);
  }, []);

  const id = useId();
  const descId = description ? `${id}-desc` : undefined;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={descId}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // 指を動かしてもボタンの上にいる間は続ける（離したら pointerup で取り消し）
          e.currentTarget.setPointerCapture?.(e.pointerId);
          begin();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (!e.repeat) begin();
        }}
        onKeyUp={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          cancel();
        }}
        onBlur={cancel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: 'none' }}
        className={`relative min-h-11 overflow-hidden rounded-lg select-none touch-manipulation disabled:opacity-50 ${className}`}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-current opacity-20"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
        <span className="relative">{children}</span>
      </button>
      {description && (
        <span id={descId} className="sr-only">
          {description}
        </span>
      )}
    </>
  );
}
