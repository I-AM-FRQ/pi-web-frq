"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ImageLightboxProps = {
  src: string;
  alt?: string;
  onClose: () => void;
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 12;
const WHEEL_STEP = 1.15;

function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
}

/**
 * 图片查看器：滚轮缩放（以鼠标位置为中心）、拖拽平移、双击放大/还原、控件缩放与重置。
 * 不依赖第三方库，直接用 CSS transform 实现，行为完全可控。
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);

  // 预加载拿到原始尺寸，便于按需限制初始显示尺寸
  useEffect(() => {
    let cancelled = false;
    setDimensions(null);
    setFailed(false);
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      setDimensions({ width: probe.naturalWidth || 800, height: probe.naturalHeight || 600 });
    };
    probe.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    probe.src = src;
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** 以某个屏幕点为中心缩放（默认屏幕中心）。 */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    setScale((currentScale) => {
      const nextScale = clampScale(currentScale * factor);
      if (nextScale === currentScale) return currentScale;
      const rect = stage?.getBoundingClientRect();
      setOffset((currentOffset) => {
        if (!rect) return currentOffset;
        const cx = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
        const cy = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
        const ratio = nextScale / currentScale;
        return { x: cx - (cx - currentOffset.x) * ratio, y: cy - (cy - currentOffset.y) * ratio };
      });
      return nextScale;
    });
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.originX + (event.clientX - drag.pointerX), y: drag.originY + (event.clientY - drag.pointerY) });
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const imageStyle = dimensions
    ? { width: `${dimensions.width}px`, height: `${dimensions.height}px`, maxWidth: "calc(100vw - 80px)", maxHeight: "calc(100vh - 140px)" }
    : undefined;

  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="图片查看" onClick={onClose}>
      <div
        className={`lightbox-stage${dragging ? " dragging" : ""}`}
        ref={stageRef}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, event.clientX, event.clientY);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (scale > 1.01) reset();
          else zoomAt(2.5, event.clientX, event.clientY);
        }}
      >
        {failed ? (
          <p className="lightbox-center-text">
            图片加载失败 · <a className="lightbox-open" href={src} target="_blank" rel="noreferrer noopener">在新窗口打开</a>
          </p>
        ) : null}
        {!failed && !dimensions ? <p className="lightbox-center-text">正在加载图片…</p> : null}
        {!failed && dimensions ? (
          <div
            className="lightbox-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img
              className="lightbox-image"
              src={src}
              alt={alt ?? ""}
              draggable={false}
              style={{ ...imageStyle, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, cursor: dragging ? "grabbing" : "grab" }}
            />
          </div>
        ) : null}
      </div>

      {!failed && dimensions ? (
        <>
          <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => zoomAt(1 / 1.3)} aria-label="缩小" title="缩小">−</button>
            <button type="button" onClick={reset} aria-label="重置缩放" title="重置">{Math.round(scale * 100)}%</button>
            <button type="button" onClick={() => zoomAt(1.3)} aria-label="放大" title="放大">＋</button>
            <span className="lightbox-divider" aria-hidden="true" />
            <a className="lightbox-open" href={src} target="_blank" rel="noreferrer noopener" title="在新窗口打开原图">原图</a>
            <button type="button" className="lightbox-close" onClick={onClose} aria-label="关闭" title="关闭（Esc）">×</button>
          </div>
          <p className="lightbox-hint">滚轮 / 双击缩放 · 拖拽平移 · Esc 关闭</p>
        </>
      ) : null}
    </div>
  );
}
