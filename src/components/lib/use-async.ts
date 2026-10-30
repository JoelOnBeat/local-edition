"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The error shape every page shows: a plain message and, when the API sent one, its code. */
export interface ShownError {
  message: string;
  code?: string;
  status?: number;
}

export function toShownError(e: unknown): ShownError {
  if (e && typeof e === "object" && "message" in e) {
    const x = e as { message: string; code?: string; status?: number };
    return { message: x.message || "Something went wrong.", code: x.code, status: x.status };
  }
  return { message: "Something went wrong." };
}

interface Settled<T> {
  key: string;
  data?: T;
  error?: ShownError;
}

/**
 * Loads `fn()` whenever `key` changes (null skips). `loading` is derived, so the effect never sets state synchronously.
 * `data` keeps the last result while a reload runs, so pages do not flash back to skeletons.
 */
export function useAsync<T>(key: string | null, fn: () => Promise<T>) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [override, setOverride] = useState<{ key: string; data: T } | null>(null);
  const fullKey = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (fullKey === null) return;
    let alive = true;
    fnRef.current().then(
      (data) => alive && setSettled({ key: fullKey, data }),
      (e: unknown) => alive && setSettled({ key: fullKey, error: toShownError(e) }),
    );
    return () => {
      alive = false;
    };
  }, [fullKey]);

  const current = settled?.key === fullKey ? settled : null;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => fullKey && setOverride({ key: fullKey, data }), [fullKey]);
  const data = override?.key === fullKey ? override.data : current?.data ?? (settled && !settled.error ? settled.data : undefined);
  return {
    data,
    error: current?.error,
    loading: fullKey !== null && current === null,
    reload,
    setData,
  };
}
