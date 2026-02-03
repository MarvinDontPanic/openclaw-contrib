import type { RateLimitStatus } from "../types";

type RateLimitState = {
  client: { request: (method: string, params: unknown) => Promise<unknown> } | null;
  rateLimitStatus: RateLimitStatus | null;
};

export async function loadRateLimitStatus(state: RateLimitState): Promise<void> {
  if (!state.client) return;

  try {
    const res = await state.client.request("usage.status", {});
    state.rateLimitStatus = res as RateLimitStatus;
  } catch (err) {
    console.error("[rate-limit] failed to load status:", err);
  }
}
