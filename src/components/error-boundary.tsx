"use client";

import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * 应用级错误边界：任一子树渲染/生命周期抛出错误时，
 * 显示可恢复的错误提示，而不是让整页白屏（Next 默认错误页）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("pi-web-frq UI error boundary caught:", error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div style={{
        alignItems: "center",
        background: "var(--bg, #0c0f15)",
        color: "var(--text, #e8ecf4)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-body, system-ui, sans-serif)",
        gap: 14,
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
        textAlign: "center",
      }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>界面出现错误</h1>
        <p style={{ color: "var(--text-secondary, #9aa6b8)", fontSize: 13, lineHeight: 1.6, margin: 0, maxWidth: 480 }}>
          {this.state.error.message || "发生了未知错误。"}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "var(--accent, #818cf8)",
            border: 0,
            borderRadius: 8,
            color: "var(--accent-contrast, #0d1020)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 22px",
          }}
        >
          刷新页面
        </button>
      </div>
    );
  }
}
