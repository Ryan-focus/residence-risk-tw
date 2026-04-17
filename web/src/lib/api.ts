import { AssessResponse, ApiError } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

export async function assessAddress(
  address: string
): Promise<AssessResponse> {
  const res = await fetch(`${BASE_URL}/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      error: "UNKNOWN",
      code: "UNKNOWN",
      message: "伺服器回應異常",
    }));
    throw new Error(err.message);
  }

  return res.json();
}
