import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { NormalizedUsage, UsageLike } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { normalizeUsage } from "../agents/usage.js";
import {
  resolveSessionFilePath,
  resolveSessionTranscriptsDirForAgent,
} from "../config/sessions/paths.js";
import { estimateUsageCost, resolveModelCostConfig } from "../utils/usage-format.js";

type CostBreakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type ParsedUsageEntry = {
  usage: NormalizedUsage;
  costTotal?: number;
  costBreakdown?: CostBreakdown;
  provider?: string;
  model?: string;
  timestamp?: Date;
};

export type CostUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  unattributedCost: number;
  realCost: number;
  phantomCost: number;
  missingCostEntries: number;
};

export type CostUsageDailyEntry = CostUsageTotals & {
  date: string;
};

export type CostUsageSummary = {
  updatedAt: number;
  days: number;
  daily: CostUsageDailyEntry[];
  totals: CostUsageTotals;
  byProvider: Record<string, CostUsageTotals>;
  byModel: Record<string, CostUsageTotals>;
  dailyByProvider: Record<string, Record<string, number>>; // date -> provider -> cost
  dailyByModel: Record<string, Record<string, number>>; // date -> model -> cost
  dailyReal: Record<string, number>; // date -> real cost
  dailyPhantom: Record<string, number>; // date -> phantom cost
  providerModes: Record<string, "real" | "phantom">; // provider -> billing mode
};

export type SessionCostSummary = CostUsageTotals & {
  sessionId?: string;
  sessionFile?: string;
  lastActivity?: number;
};

const emptyTotals = (): CostUsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  unattributedCost: 0,
  realCost: 0,
  phantomCost: 0,
  missingCostEntries: 0,
});

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const extractCostTotal = (usageRaw?: UsageLike | null): number | undefined => {
  if (!usageRaw || typeof usageRaw !== "object") {
    return undefined;
  }
  const record = usageRaw as Record<string, unknown>;
  const cost = record.cost as Record<string, unknown> | undefined;
  const total = toFiniteNumber(cost?.total);
  if (total === undefined) {
    return undefined;
  }
  if (total < 0) {
    return undefined;
  }
  return total;
};

const extractCostBreakdown = (usageRaw?: UsageLike | null): CostBreakdown | undefined => {
  if (!usageRaw || typeof usageRaw !== "object") {
    return undefined;
  }
  const record = usageRaw as Record<string, unknown>;
  const cost = record.cost as Record<string, unknown> | undefined;
  if (!cost) {
    return undefined;
  }
  const input = toFiniteNumber(cost.input);
  const output = toFiniteNumber(cost.output);
  const cacheRead = toFiniteNumber(cost.cacheRead);
  const cacheWrite = toFiniteNumber(cost.cacheWrite);
  const total = toFiniteNumber(cost.total);
  if (total === undefined) {
    return undefined;
  }
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    total,
  };
};

const parseTimestamp = (entry: Record<string, unknown>): Date | undefined => {
  const raw = entry.timestamp;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  const message = entry.message as Record<string, unknown> | undefined;
  const messageTimestamp = toFiniteNumber(message?.timestamp);
  if (messageTimestamp !== undefined) {
    const parsed = new Date(messageTimestamp);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return undefined;
};

const parseUsageEntry = (entry: Record<string, unknown>): ParsedUsageEntry | null => {
  const message = entry.message as Record<string, unknown> | undefined;
  const role = message?.role;
  if (role !== "assistant") {
    return null;
  }

  const usageRaw =
    (message?.usage as UsageLike | undefined) ?? (entry.usage as UsageLike | undefined);
  const usage = normalizeUsage(usageRaw);
  if (!usage) {
    return null;
  }

  const provider =
    (typeof message?.provider === "string" ? message?.provider : undefined) ??
    (typeof entry.provider === "string" ? entry.provider : undefined);
  const model =
    (typeof message?.model === "string" ? message?.model : undefined) ??
    (typeof entry.model === "string" ? entry.model : undefined);

  return {
    usage,
    costTotal: extractCostTotal(usageRaw),
    costBreakdown: extractCostBreakdown(usageRaw),
    provider,
    model,
    timestamp: parseTimestamp(entry),
  };
};

const formatDayKey = (date: Date): string =>
  date.toLocaleDateString("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

const applyUsageTotals = (totals: CostUsageTotals, usage: NormalizedUsage) => {
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  const totalTokens =
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  totals.totalTokens += totalTokens;
};

const applyCostTotal = (
  totals: CostUsageTotals,
  costTotal: number | undefined,
  costBreakdown?: CostBreakdown,
) => {
  if (costTotal === undefined) {
    totals.missingCostEntries += 1;
    return;
  }
  totals.totalCost += costTotal;
  if (costBreakdown) {
    totals.inputCost += costBreakdown.input;
    totals.outputCost += costBreakdown.output;
    totals.cacheReadCost += costBreakdown.cacheRead;
    totals.cacheWriteCost += costBreakdown.cacheWrite;
    // Track any difference as unattributed (rounding, missing breakdown components, etc.)
    const attributedCost =
      costBreakdown.input +
      costBreakdown.output +
      costBreakdown.cacheRead +
      costBreakdown.cacheWrite;
    const diff = costTotal - attributedCost;
    if (diff > 0.001) {
      totals.unattributedCost += diff;
    }
  } else {
    // No breakdown available — entire cost is unattributed
    totals.unattributedCost += costTotal;
  }
};

async function scanUsageFile(params: {
  filePath: string;
  config?: OpenClawConfig;
  onEntry: (entry: ParsedUsageEntry) => void;
}): Promise<void> {
  const fileStream = fs.createReadStream(params.filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const entry = parseUsageEntry(parsed);
      if (!entry) {
        continue;
      }

      if (entry.costTotal === undefined) {
        const cost = resolveModelCostConfig({
          provider: entry.provider,
          model: entry.model,
          config: params.config,
        });
        entry.costTotal = estimateUsageCost({ usage: entry.usage, cost });
      }

      params.onEntry(entry);
    } catch {
      // Ignore malformed lines
    }
  }
}

export async function loadCostUsageSummary(params?: {
  days?: number;
  config?: OpenClawConfig;
  agentId?: string;
  includeDeleted?: boolean;
}): Promise<CostUsageSummary> {
  const days = Math.max(1, Math.floor(params?.days ?? 30));
  const includeDeleted = params?.includeDeleted ?? true;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - (days - 1));
  const sinceTime = since.getTime();

  const dailyMap = new Map<string, CostUsageTotals>();
  const providerMap = new Map<string, CostUsageTotals>();
  const modelMap = new Map<string, CostUsageTotals>();
  const dailyByProviderMap = new Map<string, Map<string, number>>(); // date -> provider -> cost
  const dailyByModelMap = new Map<string, Map<string, number>>(); // date -> model -> cost
  const dailyRealMap = new Map<string, number>(); // date -> real cost
  const dailyPhantomMap = new Map<string, number>(); // date -> phantom cost
  const totals = emptyTotals();

  // Build provider mode lookup from config
  const providerModes = new Map<string, "real" | "phantom">();
  const authProfiles = params?.config?.auth?.profiles ?? {};
  for (const [, profile] of Object.entries(authProfiles)) {
    if (profile?.provider && profile?.mode) {
      // api_key = real cost (billed), oauth/token = phantom (estimated)
      const mode = profile.mode === "api_key" ? "real" : "phantom";
      providerModes.set(profile.provider, mode);
    }
  }

  const getProviderMode = (provider: string | undefined): "real" | "phantom" => {
    if (!provider) return "phantom";
    return providerModes.get(provider) ?? "phantom"; // default to phantom if unknown
  };

  const sessionsDir = resolveSessionTranscriptsDirForAgent(params?.agentId);
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);

  const isValidFile = (name: string): boolean => {
    if (name.endsWith(".jsonl")) {
      return true;
    }
    if (includeDeleted && name.includes(".jsonl.deleted.")) {
      return true;
    }
    return false;
  };

  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && isValidFile(entry.name))
        .map(async (entry) => {
          const filePath = path.join(sessionsDir, entry.name);
          const stats = await fs.promises.stat(filePath).catch(() => null);
          if (!stats) {
            return null;
          }
          if (stats.mtimeMs < sinceTime) {
            return null;
          }
          return filePath;
        }),
    )
  ).filter((filePath): filePath is string => Boolean(filePath));

  for (const filePath of files) {
    await scanUsageFile({
      filePath,
      config: params?.config,
      onEntry: (entry) => {
        const ts = entry.timestamp?.getTime();
        if (!ts || ts < sinceTime) {
          return;
        }
        const dayKey = formatDayKey(entry.timestamp ?? now);
        const bucket = dailyMap.get(dayKey) ?? emptyTotals();
        applyUsageTotals(bucket, entry.usage);
        applyCostTotal(bucket, entry.costTotal, entry.costBreakdown);
        dailyMap.set(dayKey, bucket);

        applyUsageTotals(totals, entry.usage);
        applyCostTotal(totals, entry.costTotal, entry.costBreakdown);

        // Track real vs phantom cost
        const costAmount = entry.costTotal ?? 0;
        const billingMode = getProviderMode(entry.provider);
        if (billingMode === "real") {
          totals.realCost += costAmount;
          bucket.realCost += costAmount;
          dailyRealMap.set(dayKey, (dailyRealMap.get(dayKey) ?? 0) + costAmount);
        } else {
          totals.phantomCost += costAmount;
          bucket.phantomCost += costAmount;
          dailyPhantomMap.set(dayKey, (dailyPhantomMap.get(dayKey) ?? 0) + costAmount);
        }

        // Track by provider
        if (entry.provider) {
          const providerBucket = providerMap.get(entry.provider) ?? emptyTotals();
          applyUsageTotals(providerBucket, entry.usage);
          applyCostTotal(providerBucket, entry.costTotal, entry.costBreakdown);
          if (billingMode === "real") {
            providerBucket.realCost += costAmount;
          } else {
            providerBucket.phantomCost += costAmount;
          }
          providerMap.set(entry.provider, providerBucket);

          // Track daily by provider
          const dayProviders = dailyByProviderMap.get(dayKey) ?? new Map<string, number>();
          dayProviders.set(
            entry.provider,
            (dayProviders.get(entry.provider) ?? 0) + (entry.costTotal ?? 0),
          );
          dailyByProviderMap.set(dayKey, dayProviders);
        }

        // Track by model
        if (entry.model) {
          const modelBucket = modelMap.get(entry.model) ?? emptyTotals();
          applyUsageTotals(modelBucket, entry.usage);
          applyCostTotal(modelBucket, entry.costTotal, entry.costBreakdown);
          if (billingMode === "real") {
            modelBucket.realCost += costAmount;
          } else {
            modelBucket.phantomCost += costAmount;
          }
          modelMap.set(entry.model, modelBucket);

          // Track daily by model
          const dayModels = dailyByModelMap.get(dayKey) ?? new Map<string, number>();
          dayModels.set(entry.model, (dayModels.get(entry.model) ?? 0) + (entry.costTotal ?? 0));
          dailyByModelMap.set(dayKey, dayModels);
        }
      },
    });
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, bucket]) => Object.assign({ date }, bucket))
    .toSorted((a, b) => a.date.localeCompare(b.date));

  const byProvider: Record<string, CostUsageTotals> = {};
  for (const [provider, bucket] of providerMap) {
    byProvider[provider] = bucket;
  }

  const byModel: Record<string, CostUsageTotals> = {};
  for (const [model, bucket] of modelMap) {
    byModel[model] = bucket;
  }

  // Convert daily maps to plain objects
  const dailyByProvider: Record<string, Record<string, number>> = {};
  for (const [date, providers] of dailyByProviderMap) {
    dailyByProvider[date] = Object.fromEntries(providers);
  }

  const dailyByModel: Record<string, Record<string, number>> = {};
  for (const [date, models] of dailyByModelMap) {
    dailyByModel[date] = Object.fromEntries(models);
  }

  const dailyReal: Record<string, number> = Object.fromEntries(dailyRealMap);
  const dailyPhantom: Record<string, number> = Object.fromEntries(dailyPhantomMap);

  // Build provider modes map for frontend
  const providerModesRecord: Record<string, "real" | "phantom"> = {};
  for (const [provider, mode] of providerModes) {
    providerModesRecord[provider] = mode;
  }

  return {
    updatedAt: Date.now(),
    days,
    daily,
    totals,
    byProvider,
    byModel,
    dailyByProvider,
    dailyByModel,
    dailyReal,
    dailyPhantom,
    providerModes: providerModesRecord,
  };
}

export async function loadSessionCostSummary(params: {
  sessionId?: string;
  sessionEntry?: SessionEntry;
  sessionFile?: string;
  config?: OpenClawConfig;
}): Promise<SessionCostSummary | null> {
  const sessionFile =
    params.sessionFile ??
    (params.sessionId ? resolveSessionFilePath(params.sessionId, params.sessionEntry) : undefined);
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return null;
  }

  const totals = emptyTotals();
  let lastActivity: number | undefined;

  await scanUsageFile({
    filePath: sessionFile,
    config: params.config,
    onEntry: (entry) => {
      applyUsageTotals(totals, entry.usage);
      applyCostTotal(totals, entry.costTotal, entry.costBreakdown);
      const ts = entry.timestamp?.getTime();
      if (ts && (!lastActivity || ts > lastActivity)) {
        lastActivity = ts;
      }
    },
  });

  return {
    sessionId: params.sessionId,
    sessionFile,
    lastActivity,
    ...totals,
  };
}
