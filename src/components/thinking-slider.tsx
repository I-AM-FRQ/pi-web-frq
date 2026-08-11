"use client";

import { useRef } from "react";
import type { ThinkingLevel } from "@/contracts";

export type ThinkingSelection = ThinkingLevel | "auto";

export const THINKING_NAMES: Record<ThinkingLevel, string> = { off: "关闭", minimal: "极低", low: "低", medium: "中等", high: "高", xhigh: "极高", max: "最大" };

/** 全部档位（固定顺序）。滑块刻度始终显示全部档位，模型不支持的档位提交时由服务端映射为最接近的支持档位。 */
export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

type ThinkingSliderProps = {
  level: ThinkingSelection;
  options: ThinkingLevel[];
  recommended: ThinkingLevel;
  onChange: (level: ThinkingSelection) => void;
};

/**
 * 思考强度选择面板（滑块 + 自动按钮 + 全部档位刻度）。
 * 滑块拖动直接写 DOM，避免 pointermove 高频触发 React 渲染导致卡顿；松手后由新值渲染回正。
 * 刻度固定为全部档位；选中模型不支持的档位时，提交侧会映射为最接近的支持档位。
 */
export function ThinkingSlider({ level, options: _options, recommended, onChange }: ThinkingSliderProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragRectRef = useRef<DOMRect | null>(null);
  const lastRatioRef = useRef(0);

  // auto 时滑块停在推荐档位位置（视觉提示自动将使用的强度），文案仍显示“自动”
  const displayed = level === "auto" ? recommended : ALL_THINKING_LEVELS.includes(level) ? level : ALL_THINKING_LEVELS[0];
  const index = ALL_THINKING_LEVELS.indexOf(displayed);
  const snap = (index / Math.max(ALL_THINKING_LEVELS.length - 1, 1)) * 100;

  const move = (clientX: number, commit: boolean) => {
    const rect = dragRectRef.current;
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    lastRatioRef.current = ratio;
    const percent = ratio * 100;
    if (fillRef.current) fillRef.current.style.width = `${percent}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${percent}%`;
    if (commit) {
      const next = ALL_THINKING_LEVELS[Math.round(ratio * (ALL_THINKING_LEVELS.length - 1))] ?? "off";
      if (next !== level) onChange(next);
    }
  };
  const commit = () => {
    const ratio = lastRatioRef.current;
    const next = ALL_THINKING_LEVELS[Math.round(ratio * (ALL_THINKING_LEVELS.length - 1))] ?? "off";
    if (next !== level) onChange(next);
  };

  return (
    <div className="composer-thinking-menu" role="group" aria-label="思考强度">
      <div className="thinking-head">
        <button type="button" className={`thinking-auto${level === "auto" ? " selected" : ""}`} onClick={() => onChange("auto")} aria-pressed={level === "auto"}>自动</button>
        <span className="thinking-current">{level === "auto" ? "自动" : THINKING_NAMES[level]}</span>
      </div>
      <div
        className="thinking-track"
        role="slider"
        aria-label="思考强度"
        aria-valuemin={0}
        aria-valuemax={Math.max(ALL_THINKING_LEVELS.length - 1, 0)}
        aria-valuenow={index}
        aria-valuetext={THINKING_NAMES[displayed]}
        onPointerDown={(event) => {
          event.preventDefault();
          draggingRef.current = true;
          dragRectRef.current = event.currentTarget.getBoundingClientRect();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          move(event.clientX, true);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) move(event.clientX, false);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
          dragRectRef.current = null;
          commit();
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          dragRectRef.current = null;
          commit();
        }}
      >
        <div className="thinking-rail" aria-hidden="true" />
        <div className="thinking-fill" ref={fillRef} aria-hidden="true" style={{ width: `${snap}%` }} />
        <div className="thinking-thumb" ref={thumbRef} aria-hidden="true" style={{ left: `${snap}%` }} />
      </div>
      <div className="thinking-labels">
        {ALL_THINKING_LEVELS.map((level) => (
          <span key={level} className={level === displayed ? "active" : ""} style={{ left: `${(ALL_THINKING_LEVELS.indexOf(level) / Math.max(ALL_THINKING_LEVELS.length - 1, 1)) * 100}%` }}>
            {THINKING_NAMES[level]}
          </span>
        ))}
      </div>
    </div>
  );
}
