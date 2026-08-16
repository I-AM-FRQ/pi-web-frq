"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AuthState = "unknown" | "authenticated" | "unauthenticated";

type AuthErrorPayload = { error?: { message?: unknown } };

const ACCESS_KEY_STORAGE = "piweb_access_key";

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as AuthErrorPayload;
    if (typeof payload.error?.message === "string" && payload.error.message) return payload.error.message;
  } catch {
    // Non-JSON responses still get a useful local message.
  }
  return fallback;
}

export function useAuth() {
  const [status, setStatus] = useState<AuthState>("unknown");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  }, []);

  const login = useCallback(async (key: string): Promise<{ ok: boolean; error?: string }> => {
    const value = key.trim();
    if (!value) {
      const message = "请输入访问密钥。";
      setError(message);
      return { ok: false, error: message };
    }
    setError("");
    try {
      const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: value }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "访问密钥无效。"));
      localStorage.setItem(ACCESS_KEY_STORAGE, value);
      setStatus("authenticated");
      return { ok: true };
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return { ok: false };
      const message = caught instanceof Error ? caught.message : "登录失败，请重试。";
      setStatus("unauthenticated");
      setError(message);
      return { ok: false, error: message };
    }
  }, [request]);

  const logout = useCallback(async () => {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch {
      // Clearing the local cache is still important if the server is unreachable.
    }
    try { localStorage.removeItem(ACCESS_KEY_STORAGE); } catch { /* 隐私模式 */ }
    setStatus("unauthenticated");
    setError("");
  }, [request]);

  useEffect(() => {
    let disposed = false;
    const initialize = async () => {
      let storedKey = "";
      try { storedKey = localStorage.getItem(ACCESS_KEY_STORAGE) ?? ""; } catch { /* 隐私模式 */ }
      try {
        const response = storedKey
          ? await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: storedKey }) })
          : await request("/api/auth/status");
        if (disposed) return;
        if (response.ok) {
          setStatus("authenticated");
          setError("");
        } else {
          if (storedKey) {
            try { localStorage.removeItem(ACCESS_KEY_STORAGE); } catch { /* 隐私模式 */ }
          }
          setStatus("unauthenticated");
          setError("");
        }
      } catch (caught) {
        if (disposed || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setStatus("unauthenticated");
        setError("无法连接认证服务，请重试。");
      }
    };
    void initialize();
    return () => {
      disposed = true;
      controllerRef.current?.abort();
    };
  }, [request]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const originalFetch = window.fetch;
    const authenticatedFetch: typeof window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        try { localStorage.removeItem(ACCESS_KEY_STORAGE); } catch { /* 隐私模式 */ }
        setStatus("unauthenticated");
        setError("");
      }
      return response;
    };
    window.fetch = authenticatedFetch;
    const controller = new AbortController();
    const verifySession = async () => {
      try {
        const response = await fetch("/api/auth/status", { cache: "no-store", signal: controller.signal });
        if (!response.ok && !controller.signal.aborted) {
          setStatus("unauthenticated");
          setError("");
        }
      } catch {
        // Temporary network failures must not discard an otherwise valid local session.
      }
    };
    const interval = window.setInterval(() => { void verifySession(); }, 15_000);
    window.addEventListener("focus", verifySession);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", verifySession);
      if (window.fetch === authenticatedFetch) window.fetch = originalFetch;
    };
  }, [status]);

  return { status, error, login, logout };
}

export { ACCESS_KEY_STORAGE };
