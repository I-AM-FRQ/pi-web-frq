const lockedSessionIds = new Set<string>();

export type SessionLock = {
  release(): void;
};

export function tryLockSession(sessionId: string): SessionLock | undefined {
  if (lockedSessionIds.has(sessionId)) return undefined;
  lockedSessionIds.add(sessionId);

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      lockedSessionIds.delete(sessionId);
    },
  };
}
