"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useAuth } from "@/client/use-auth";

type AuthGateProps = { children: ReactNode };

export function AuthGate({ children }: AuthGateProps) {
  const { status, error: authError, login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") inputRef.current?.focus();
  }, [status]);

  if (status === "unknown") {
    return <div className="auth-gate auth-gate-loading" role="status" aria-label="正在验证访问权限"><span className="auth-gate-spinner" />正在验证访问权限…</div>;
  }
  if (status === "authenticated") return <>{children}</>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    void login(key).then((result) => {
      if (!result.ok) setError(result.error ?? "登录失败，请重试。");
    }).finally(() => setBusy(false));
  };

  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
      <div className="auth-gate-panel">
        <div className="auth-gate-mark" aria-hidden="true"><span>π</span></div>
        <p className="auth-gate-eyebrow">PI WEB WORKSPACE</p>
        <h1 id="auth-gate-title">输入访问密钥</h1>
        <p className="auth-gate-description">这是一个受保护的工作区，请使用服务端生成的访问密钥继续。</p>
        <form onSubmit={submit}>
          <label htmlFor="auth-access-key">访问密钥</label>
          <input ref={inputRef} id="auth-access-key" type="password" value={key} onChange={(event) => { setKey(event.target.value); setError(""); }} autoComplete="current-password" spellCheck={false} autoFocus aria-invalid={Boolean(error || authError)} />
          {error || authError ? <p className="auth-gate-error" role="alert">{error || authError}</p> : null}
          <button type="submit" className="auth-gate-submit" disabled={busy || !key.trim()}>{busy ? <><span className="auth-gate-button-spinner" />验证中…</> : "进入工作区"}</button>
        </form>
      </div>
    </div>
  );
}
