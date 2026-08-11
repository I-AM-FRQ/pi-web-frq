"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThinkingLevel } from "@/contracts";

export type FontStyle = "yahei" | "system" | "mono";

export type WorkbenchSettings = {
  fontStyle: FontStyle;
  bodyFontSize: 13 | 14 | 15;
  inputFontSize: 14 | 16 | 18;
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel | "";
  autoRetry: boolean;
  /** 执行完成提醒：off=关闭 page=仅页面提示 desktop=仅系统通知 both=前台页面提示+后台系统通知 */
  completionAlert: "off" | "page" | "desktop" | "both";
};

export const DEFAULT_SETTINGS: WorkbenchSettings = {
  fontStyle: "system",
  bodyFontSize: 14,
  inputFontSize: 16,
  defaultModel: "",
  defaultThinkingLevel: "",
  autoRetry: true,
  completionAlert: "both",
};

const STORAGE_KEY = "pi-workbench-settings";

const FONT_FAMILIES: Record<FontStyle, string> = {
  yahei: '"Microsoft YaHei", "微软雅黑", "Segoe UI", system-ui, sans-serif',
  system: '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"Cascadia Code", "Consolas", "JetBrains Mono", "Microsoft YaHei", monospace',
};

function storedSettings(): Partial<WorkbenchSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if (parsed.fontStyle === "yahei" || parsed.fontStyle === "system" || parsed.fontStyle === "mono") result.fontStyle = parsed.fontStyle;
    if (parsed.bodyFontSize === 13 || parsed.bodyFontSize === 14 || parsed.bodyFontSize === 15) result.bodyFontSize = parsed.bodyFontSize;
    if (parsed.inputFontSize === 14 || parsed.inputFontSize === 16 || parsed.inputFontSize === 18) result.inputFontSize = parsed.inputFontSize;
    if (typeof parsed.defaultModel === "string" && parsed.defaultModel.length <= 200) result.defaultModel = parsed.defaultModel;
    if (typeof parsed.defaultThinkingLevel === "string" && ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(parsed.defaultThinkingLevel)) result.defaultThinkingLevel = parsed.defaultThinkingLevel;
    if (typeof parsed.autoRetry === "boolean") result.autoRetry = parsed.autoRetry;
    if (parsed.completionAlert === "off" || parsed.completionAlert === "page" || parsed.completionAlert === "desktop" || parsed.completionAlert === "both") result.completionAlert = parsed.completionAlert;
    return result as Partial<WorkbenchSettings>;
  } catch {
    return {};
  }
}

type SettingsContextValue = {
  settings: WorkbenchSettings;
  setSettings: (patch: Partial<WorkbenchSettings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<WorkbenchSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettingsState({ ...DEFAULT_SETTINGS, ...storedSettings() });
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式等场景下忽略持久化失败
    }
    const root = document.documentElement;
    root.style.setProperty("--font-body", FONT_FAMILIES[settings.fontStyle]);
    root.style.setProperty("--font-size-body", `${settings.bodyFontSize}px`);
    root.style.setProperty("--font-size-composer", `${settings.inputFontSize}px`);
  }, [hydrated, settings]);

  const setSettings = useCallback((patch: Partial<WorkbenchSettings>) => {
    setSettingsState((current) => ({ ...current, ...patch }));
  }, []);

  return <SettingsContext.Provider value={{ settings, setSettings }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within a SettingsProvider.");
  return context;
}
