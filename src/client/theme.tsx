"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export type ThemeOrigin = { x: number; y: number };

const STORAGE_KEY = "pi-workbench-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR 与客户端首帧使用同一默认值；真正主题色由 <head> 内联脚本先行设置。
  const [theme, setThemeState] = useState<Theme>("dark");
  const originRef = useRef<ThemeOrigin | null>(null);
  const firstEffectRef = useRef(true);
  const skipAnimationRef = useRef(true);

  // 首帧固定，随后恢复存储/系统主题（不播放动画）
  useEffect(() => {
    const timer = window.setTimeout(() => setThemeState(storedTheme() ?? systemTheme()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    // 首次渲染不写主题，等待上面的恢复流程，避免覆盖 <head> 内联脚本的结果
    if (firstEffectRef.current) {
      firstEffectRef.current = false;
      return;
    }

    const origin = originRef.current;
    originRef.current = null;
    const apply = () => {
      root.dataset.theme = theme;
    };
    const canAnimate = !skipAnimationRef.current && origin !== null && !prefersReducedMotion();

    if (canAnimate && typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(apply);
      void transition.ready.then(() => {
        const { x, y } = origin!;
        const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        try {
          // 圆形扩散揭示：从点击位置扩散到覆盖整个视口
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
          );
        } catch {
          // 不支持 pseudoElement 动画时使用默认交叉淡化
        }
      });
    } else {
      apply();
    }

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 隐私模式等场景下忽略持久化失败
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme, origin?: ThemeOrigin) => {
    originRef.current = origin ?? null;
    skipAnimationRef.current = false;
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback((origin?: ThemeOrigin) => {
    setThemeState((current) => {
      originRef.current = origin ?? null;
      skipAnimationRef.current = false;
      return current === "dark" ? "light" : "dark";
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider.");
  return context;
}
