"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/** Simple data loader with manual refresh + error toast handling. */
export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memuat data.";
      setError(message);
    } finally {
      setLoading(false);
    }
     
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
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
