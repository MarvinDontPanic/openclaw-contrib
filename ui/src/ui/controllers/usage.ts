import type { CostUsageSummary } from "../types.js";

export type UsageDisplayMode = "cost" | "tokens";
export type UsageGroupBy = "none" | "provider" | "model" | "type";

export type UsageHost = {
  client: { request: (method: string, params?: unknown) => Promise<unknown> } | null;
  connected: boolean;
  usageLoading: boolean;
  usageSummary: CostUsageSummary | null;
  usageError: string | null;
  usageDaysFilter: number;
  usageDisplayMode: UsageDisplayMode;
  usageGroupBy: UsageGroupBy;
};

export async function loadUsage(host: UsageHost, days?: number): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.usageLoading = true;
  host.usageError = null;
  try {
    const result = await host.client.request("usage.cost", {
      days: days ?? host.usageDaysFilter,
      includeDeleted: true,
    });
    host.usageSummary = result as CostUsageSummary;
  } catch (err) {
    host.usageError = String(err);
  } finally {
    host.usageLoading = false;
  }
}
