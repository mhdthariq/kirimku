"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Simple data loader with manual refresh + error toast handling. */
export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Inline fetchers are common: only the caller's dependencies select a new loader.
    const [request, setRequest] = useState(() => ({
        fetcher,
        deps: [...deps],
    }));
    if (
        request.deps.length !== deps.length ||
        deps.some((dep, i) => !Object.is(dep, request.deps[i]))
    ) {
        setRequest({ fetcher, deps: [...deps] });
    setLoading(true);
    setError(null);
    }
    const sequence = useRef(0);

  const load = useCallback(() => {
    const id = ++sequence.current;
    // The async boundary also converts a synchronously throwing fetcher to a rejection.
    const fetchData = async () => request.fetcher();
    return fetchData().then(
      (result) => {
        if (id !== sequence.current) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (id !== sequence.current) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data.");
        setLoading(false);
      },
    );
  }, [request]);

  useEffect(() => {
        void load();
        return () => {
            sequence.current++;
        };
  }, [load]);

    const reload = useCallback(() => {
        setLoading(true);
        setError(null);
        return load();
    }, [load]);

    return { data, loading, error, reload, setData };
}

/** Run an async action with busy state + success/error toasts. */
export async function runAction(
  fn: () => Promise<unknown>,
  options: { success?: string; onError?: (message: string) => void } = {},
): Promise<boolean> {
  try {
    await fn();
    if (options.success) toast.success(options.success);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Operasi gagal.";
    toast.error(message);
    options.onError?.(message);
    return false;
  }
}
