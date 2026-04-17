import { useState, useCallback } from "react";
import { AssessResponse } from "@/lib/types";
import { assessAddress } from "@/lib/api";

export function useAssess() {
  const [data, setData] = useState<AssessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assess = useCallback(async (address: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await assessAddress(address);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, assess, reset };
}
