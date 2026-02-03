import { html, nothing } from "lit";
import type { CostUsageSummary, CostUsageDailyEntry, CostUsageTotals } from "../types";

export type UsageGroupBy = "none" | "provider" | "model" | "type";

export type UsageProps = {
  loading: boolean;
  summary: CostUsageSummary | null;
  error: string | null;
  daysFilter: number;
  displayMode: "cost" | "tokens";
  groupBy: UsageGroupBy;
  onDaysFilterChange: (days: number) => void;
  onDisplayModeChange: (mode: "cost" | "tokens") => void;
  onGroupByChange: (groupBy: UsageGroupBy) => void;
  onRefresh: () => void;
};

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getValue(totals: CostUsageTotals, mode: "cost" | "tokens"): number {
  return mode === "cost" ? totals.totalCost : totals.totalTokens;
}

function formatValue(value: number, mode: "cost" | "tokens"): string {
  if (mode === "cost") {
    return formatCurrency(value);
  }
  return formatTokens(value) + " tokens";
}

// Colorblind-friendly palette - muted colors that work in dark mode
// Avoiding purple gradients and red/green adjacency
const COLOR_PALETTE = [
  "rgba(59, 130, 246, 0.75)", // blue
  "rgba(249, 115, 22, 0.75)", // orange
  "rgba(20, 184, 166, 0.75)", // teal
  "rgba(236, 72, 153, 0.75)", // pink
  "rgba(234, 179, 8, 0.75)", // amber
  "rgba(168, 85, 247, 0.75)", // purple (last resort)
  "rgba(34, 197, 94, 0.75)", // green
  "rgba(239, 68, 68, 0.75)", // red (last resort)
];

// Pre-assigned colors for specific categories
const COLORS: Record<string, string> = {
  // Paid/free distinction
  Paid: "rgba(59, 130, 246, 0.75)", // blue - paid
  Free: "rgba(59, 130, 246, 0.35)", // faded blue - free
  // Token type breakdown (paid)
  "Input (paid)": "rgba(59, 130, 246, 0.75)", // blue
  "Output (paid)": "rgba(20, 184, 166, 0.75)", // teal
  "Cache Read (paid)": "rgba(234, 179, 8, 0.75)", // amber
  "Cache Write (paid)": "rgba(249, 115, 22, 0.75)", // orange
  // Token type breakdown (free)
  "Input (free)": "rgba(59, 130, 246, 0.35)", // faded blue
  "Output (free)": "rgba(20, 184, 166, 0.35)", // faded teal
  "Cache Read (free)": "rgba(234, 179, 8, 0.35)", // faded amber
  "Cache Write (free)": "rgba(249, 115, 22, 0.35)", // faded orange
};

function getColor(key: string): string {
  if (!COLORS[key]) {
    COLORS[key] = COLOR_PALETTE[Object.keys(COLORS).length % COLOR_PALETTE.length];
  }
  return COLORS[key];
}

// Approximate pricing per 1M tokens (these are estimates)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-opus-4-5-thinking": { input: 15, output: 75 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-opus": { input: 15, output: 75 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
};

function getPricing(model: string): { input: number; output: number } | null {
  // Try exact match first
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Try partial match
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.toLowerCase().includes(key.toLowerCase())) {
      return MODEL_PRICING[key];
    }
  }
  return null;
}

export function renderUsage(props: UsageProps) {
  const totals = props.summary?.totals;
  const daily = props.summary?.daily ?? [];
  const byProvider = props.summary?.byProvider ?? {};
  const byModel = props.summary?.byModel ?? {};
  const dailyByProvider = props.summary?.dailyByProvider ?? {};
  const dailyByModel = props.summary?.dailyByModel ?? {};
  const dailyReal = props.summary?.dailyReal ?? {};
  const dailyPhantom = props.summary?.dailyPhantom ?? {};
  const providerModes = props.summary?.providerModes ?? {};
  const actualDays = daily.length;
  const mode = props.displayMode;
  const groupBy = props.groupBy;

  // Real vs phantom costs
  const realCost = totals?.realCost ?? 0;
  const phantomCost = totals?.phantomCost ?? 0;

  const avgPerDay = totals && actualDays > 0 ? getValue(totals, mode) / actualDays : 0;

  // Get breakdown keys sorted by total value
  let breakdownKeys: string[] = [];
  let breakdown: Record<string, CostUsageTotals> = {};
  let dailyBreakdown: Record<string, Record<string, number>> = {};

  if (groupBy === "provider") {
    breakdown = byProvider;
    dailyBreakdown = dailyByProvider;
  } else if (groupBy === "model") {
    breakdown = byModel;
    dailyBreakdown = dailyByModel;
  } else if (groupBy === "type" && totals) {
    // Synthetic breakdown for input/output/cache read/cache write, split by paid/free
    const makeEntry = (cost: number, tokens: number): CostUsageTotals => ({
      ...totals,
      totalCost: cost,
      totalTokens: tokens,
      realCost: 0,
      phantomCost: 0,
    });

    // Calculate paid vs free ratios
    const paidRatio = totals.totalCost > 0 ? realCost / totals.totalCost : 0;
    const freeRatio = totals.totalCost > 0 ? phantomCost / totals.totalCost : 0;

    const inputEntry = makeEntry(totals.inputCost, totals.input);
    const outputEntry = makeEntry(totals.outputCost, totals.output);
    const cacheReadEntry = makeEntry(totals.cacheReadCost ?? 0, totals.cacheRead ?? 0);
    const cacheWriteEntry = makeEntry(totals.cacheWriteCost ?? 0, totals.cacheWrite ?? 0);

    // Split into paid and free - also split tokens proportionally
    if (realCost > 0.01) {
      if (inputEntry.totalCost * paidRatio > 0.01)
        breakdown["Input (paid)"] = {
          ...inputEntry,
          totalCost: inputEntry.totalCost * paidRatio,
          totalTokens: Math.round(inputEntry.totalTokens * paidRatio),
        };
      if (outputEntry.totalCost * paidRatio > 0.01)
        breakdown["Output (paid)"] = {
          ...outputEntry,
          totalCost: outputEntry.totalCost * paidRatio,
          totalTokens: Math.round(outputEntry.totalTokens * paidRatio),
        };
      if (cacheReadEntry.totalCost * paidRatio > 0.01)
        breakdown["Cache Read (paid)"] = {
          ...cacheReadEntry,
          totalCost: cacheReadEntry.totalCost * paidRatio,
          totalTokens: Math.round(cacheReadEntry.totalTokens * paidRatio),
        };
      if (cacheWriteEntry.totalCost * paidRatio > 0.01)
        breakdown["Cache Write (paid)"] = {
          ...cacheWriteEntry,
          totalCost: cacheWriteEntry.totalCost * paidRatio,
          totalTokens: Math.round(cacheWriteEntry.totalTokens * paidRatio),
        };
    }
    if (phantomCost > 0.01) {
      if (inputEntry.totalCost * freeRatio > 0.01)
        breakdown["Input (free)"] = {
          ...inputEntry,
          totalCost: inputEntry.totalCost * freeRatio,
          totalTokens: Math.round(inputEntry.totalTokens * freeRatio),
        };
      if (outputEntry.totalCost * freeRatio > 0.01)
        breakdown["Output (free)"] = {
          ...outputEntry,
          totalCost: outputEntry.totalCost * freeRatio,
          totalTokens: Math.round(outputEntry.totalTokens * freeRatio),
        };
      if (cacheReadEntry.totalCost * freeRatio > 0.01)
        breakdown["Cache Read (free)"] = {
          ...cacheReadEntry,
          totalCost: cacheReadEntry.totalCost * freeRatio,
          totalTokens: Math.round(cacheReadEntry.totalTokens * freeRatio),
        };
      if (cacheWriteEntry.totalCost * freeRatio > 0.01)
        breakdown["Cache Write (free)"] = {
          ...cacheWriteEntry,
          totalCost: cacheWriteEntry.totalCost * freeRatio,
          totalTokens: Math.round(cacheWriteEntry.totalTokens * freeRatio),
        };
    }

    // Daily breakdown by type (approximated from overall ratios)
    const totalKnown =
      totals.inputCost +
      totals.outputCost +
      (totals.cacheReadCost ?? 0) +
      (totals.cacheWriteCost ?? 0);
    const inputPct = totalKnown > 0 ? totals.inputCost / totalKnown : 0.25;
    const outputPct = totalKnown > 0 ? totals.outputCost / totalKnown : 0.25;
    const cacheReadPct = totalKnown > 0 ? (totals.cacheReadCost ?? 0) / totalKnown : 0.25;
    const cacheWritePct = totalKnown > 0 ? (totals.cacheWriteCost ?? 0) / totalKnown : 0.25;

    for (const d of daily) {
      const dayPaid = dailyReal[d.date] ?? 0;
      const dayFree = dailyPhantom[d.date] ?? 0;
      dailyBreakdown[d.date] = {};

      if (realCost > 0.01) {
        if (inputPct > 0.005) dailyBreakdown[d.date]["Input (paid)"] = dayPaid * inputPct;
        if (outputPct > 0.005) dailyBreakdown[d.date]["Output (paid)"] = dayPaid * outputPct;
        if (cacheReadPct > 0.005)
          dailyBreakdown[d.date]["Cache Read (paid)"] = dayPaid * cacheReadPct;
        if (cacheWritePct > 0.005)
          dailyBreakdown[d.date]["Cache Write (paid)"] = dayPaid * cacheWritePct;
      }
      if (phantomCost > 0.01) {
        if (inputPct > 0.005) dailyBreakdown[d.date]["Input (free)"] = dayFree * inputPct;
        if (outputPct > 0.005) dailyBreakdown[d.date]["Output (free)"] = dayFree * outputPct;
        if (cacheReadPct > 0.005)
          dailyBreakdown[d.date]["Cache Read (free)"] = dayFree * cacheReadPct;
        if (cacheWritePct > 0.005)
          dailyBreakdown[d.date]["Cache Write (free)"] = dayFree * cacheWritePct;
      }
    }
  } else if (groupBy === "none" && totals) {
    // "Secret grouping" - always show paid vs free
    if (realCost > 0.01 || phantomCost > 0.01) {
      // Estimate token split based on cost ratio
      const totalCostSum = realCost + phantomCost;
      const paidTokens =
        totalCostSum > 0 ? Math.round(totals.totalTokens * (realCost / totalCostSum)) : 0;
      const freeTokens =
        totalCostSum > 0 ? Math.round(totals.totalTokens * (phantomCost / totalCostSum)) : 0;

      if (realCost > 0.01) {
        breakdown["Paid"] = { ...totals, totalCost: realCost, totalTokens: paidTokens };
      }
      if (phantomCost > 0.01) {
        breakdown["Free"] = { ...totals, totalCost: phantomCost, totalTokens: freeTokens };
      }

      for (const d of daily) {
        dailyBreakdown[d.date] = {};
        if (realCost > 0.01) dailyBreakdown[d.date]["Paid"] = dailyReal[d.date] ?? 0;
        if (phantomCost > 0.01) dailyBreakdown[d.date]["Free"] = dailyPhantom[d.date] ?? 0;
      }
    }
  }

  breakdownKeys = Object.keys(breakdown).sort(
    (a, b) => getValue(breakdown[b], mode) - getValue(breakdown[a], mode),
  );

  // Assign colors to keys
  breakdownKeys.forEach((key) => getColor(key));

  // Calculate max daily value for scaling
  const maxDailyValue = Math.max(...daily.map((d) => getValue(d, mode)), 0.01);

  // Build pricing tooltip content - exclude models with zero cost
  const pricingModels = Object.entries(byModel)
    .filter(([_, totals]) => totals.totalCost > 0.01)
    .map(([model]) => model)
    .slice(0, 8);

  return html`
    <section class="usage-page">
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        totals
          ? html`
              <div class="usage-header">
                <div class="usage-total-section">
                  ${
                    mode === "cost"
                      ? html`
                    <span class="usage-total">
                      ${formatCurrency(realCost)}${phantomCost > 0.01 ? html`<span class="usage-phantom-total"> (+ ${formatCurrency(phantomCost)} free)</span>` : nothing}
                    </span>
                  `
                      : html`
                    <span class="usage-total">${formatValue(getValue(totals, mode), mode)}</span>
                  `
                  }
                  <span class="usage-meta">
                    ${formatValue(avgPerDay, mode)}/day avg
                    ${
                      mode === "cost" && totals.inputCost > 0
                        ? html`
                      <span class="usage-breakdown-hint">
                        · ${formatCurrency(totals.inputCost)} in / ${formatCurrency(totals.outputCost)} out
                      </span>
                    `
                        : nothing
                    }
                  </span>
                </div>
                <div class="usage-controls">
                  <select class="usage-select" @change=${(e: Event) => props.onGroupByChange((e.target as HTMLSelectElement).value as UsageGroupBy)}>
                    <option value="none" ?selected=${groupBy === "none"}>No grouping</option>
                    <option value="provider" ?selected=${groupBy === "provider"}>By Provider</option>
                    <option value="model" ?selected=${groupBy === "model"}>By Model</option>
                    <option value="type" ?selected=${groupBy === "type"}>By Token Type</option>
                  </select>
                  <div class="btn-group">
                    ${(["cost", "tokens"] as const).map(
                      (m) => html`
                        <button
                          class="btn btn-sm ${mode === m ? "primary" : ""}"
                          @click=${() => props.onDisplayModeChange(m)}
                        >
                          ${m === "cost" ? "$" : "#"}
                        </button>
                      `,
                    )}
                  </div>
                  <div class="btn-group">
                    ${[7, 30, 90].map(
                      (days) => html`
                        <button
                          class="btn btn-sm ${props.daysFilter === days ? "primary" : ""}"
                          @click=${() => props.onDaysFilterChange(days)}
                        >
                          ${days}d
                        </button>
                      `,
                    )}
                  </div>
                  <button class="btn btn-sm" ?disabled=${props.loading} @click=${props.onRefresh}>
                    ${props.loading ? "…" : "↻"}
                  </button>
                </div>
              </div>

              ${
                totals.missingCostEntries > 0
                  ? html`<div class="usage-warning">⚠ ${totals.missingCostEntries} messages without cost data</div>`
                  : nothing
              }

              <!-- Daily chart -->
              ${
                daily.length > 0
                  ? html`
                <div class="usage-chart">
                  ${daily.map((d) => {
                    const dayValue = mode === "cost" ? d.totalCost : d.totalTokens;
                    const heightPct = maxDailyValue > 0 ? (dayValue / maxDailyValue) * 100 : 0;
                    const dayBreakdown = dailyBreakdown[d.date] ?? {};

                    // Build tooltip content for this day (now includes real/phantom split even for "none")
                    const tooltipItems =
                      Object.keys(dayBreakdown).length > 0
                        ? breakdownKeys
                            .filter((key) => (dayBreakdown[key] ?? 0) > 0.005)
                            .map((key) => ({
                              key,
                              value: dayBreakdown[key] ?? 0,
                              color: COLORS[key],
                            }))
                        : [];

                    // Render stacked segments if we have breakdown data (now includes real/phantom for "none")
                    if (Object.keys(dayBreakdown).length > 0) {
                      const segments = breakdownKeys
                        .filter((key) => (dayBreakdown[key] ?? 0) > 0)
                        .map((key) => ({
                          key,
                          value: dayBreakdown[key] ?? 0,
                          color: COLORS[key] ?? "rgba(100,100,100,0.5)",
                        }));
                      const segmentTotal = segments.reduce((sum, s) => sum + s.value, 0);

                      return html`
                        <div class="chart-bar-wrapper">
                          <div class="chart-bar-container">
                            <div class="chart-bar-stacked" style="height: ${heightPct}%">
                              ${segments.map((s) => {
                                const pct = segmentTotal > 0 ? (s.value / segmentTotal) * 100 : 0;
                                return html`<div class="chart-segment" style="height: ${pct}%; background: ${s.color};"></div>`;
                              })}
                            </div>
                          </div>
                          <div class="chart-bar-label">${formatDate(d.date)}</div>
                          <div class="chart-tooltip">
                            <div class="chart-tooltip-header">${formatDate(d.date)}: ${formatValue(dayValue, mode)}</div>
                            ${tooltipItems.map(
                              (item) => html`
                              <div class="chart-tooltip-row">
                                <span class="chart-tooltip-dot" style="background: ${item.color}"></span>
                                <span class="chart-tooltip-label">${truncateLabel(item.key)}</span>
                                <span class="chart-tooltip-value">${formatCurrency(item.value)}</span>
                              </div>
                            `,
                            )}
                          </div>
                        </div>
                      `;
                    }

                    // No grouping - single color bar
                    return html`
                      <div class="chart-bar-wrapper">
                        <div class="chart-bar-container">
                          <div class="chart-bar" style="height: ${heightPct}%"></div>
                        </div>
                        <div class="chart-bar-label">${formatDate(d.date)}</div>
                        <div class="chart-tooltip">
                          <div class="chart-tooltip-header">${formatDate(d.date)}</div>
                          <div class="chart-tooltip-row">
                            <span class="chart-tooltip-label">Total</span>
                            <span class="chart-tooltip-value">${formatValue(dayValue, mode)}</span>
                          </div>
                          ${
                            mode === "cost"
                              ? html`
                            <div class="chart-tooltip-row">
                              <span class="chart-tooltip-label">Input</span>
                              <span class="chart-tooltip-value">${formatCurrency(d.inputCost ?? 0)}</span>
                            </div>
                            <div class="chart-tooltip-row">
                              <span class="chart-tooltip-label">Output</span>
                              <span class="chart-tooltip-value">${formatCurrency(d.outputCost ?? 0)}</span>
                            </div>
                          `
                              : nothing
                          }
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `
                  : nothing
              }

              <!-- Legend (show when any breakdown exists, including real/phantom split) -->
              ${
                breakdownKeys.length > 0
                  ? html`
                <div class="usage-legend">
                  ${breakdownKeys
                    .slice(0, 8)
                    .filter((key) => getValue(breakdown[key], mode) > 0.01)
                    .map(
                      (key) => html`
                    <div class="legend-item">
                      <span class="legend-dot" style="background: ${COLORS[key]}"></span>
                      <span class="legend-label" title="${key}">${truncateLabel(key)}</span>
                      <span class="legend-value">${formatValue(getValue(breakdown[key], mode), mode)}</span>
                    </div>
                  `,
                    )}
                  ${
                    breakdownKeys.length > 8
                      ? html`
                    <div class="legend-item muted">+${breakdownKeys.length - 8} more</div>
                  `
                      : nothing
                  }
                </div>
              `
                  : nothing
              }
            `
          : props.loading
            ? html`
                <div class="usage-loading">Loading…</div>
              `
            : html`
                <div class="usage-empty">No usage data available.</div>
              `
      }

      <div class="usage-footer">
        <span>Costs are estimated using standard API pricing.</span>
        ${
          pricingModels.length > 0
            ? html`
          <span class="pricing-trigger">
            <span class="pricing-link">View pricing</span>
            <div class="pricing-tooltip">
              <div class="pricing-tooltip-title">Estimated rates ($/1M tokens)</div>
              ${pricingModels.map((model) => {
                const pricing = getPricing(model);
                return html`
                  <div class="pricing-row">
                    <span class="pricing-model">${truncateLabel(model)}</span>
                    <span class="pricing-rates">
                      ${
                        pricing
                          ? html`$${pricing.input} in / $${pricing.output} out`
                          : html`
                              <span class="pricing-unknown">Unknown</span>
                            `
                      }
                    </span>
                  </div>
                `;
              })}
            </div>
          </span>
        `
            : nothing
        }
      </div>
    </section>

    <style>
      .usage-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: calc(100vh - 180px);
      }
      .usage-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 12px;
      }
      .usage-total-section {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .usage-total {
        font-size: 32px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .usage-phantom-total {
        font-size: 24px;
        font-weight: 400;
        color: var(--text-muted, #888);
        opacity: 0.7;
      }
      .usage-meta {
        font-size: 14px;
        color: var(--text-muted, #888);
      }
      .usage-breakdown-hint {
        font-size: 13px;
      }
      .usage-controls {
        display: flex;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }
      .usage-select {
        padding: 6px 10px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-subtle, #1a1a2e);
        color: var(--text-primary, #fff);
        cursor: pointer;
      }
      .usage-warning {
        font-size: 12px;
        color: var(--text-muted, #888);
        margin-bottom: 12px;
      }
      .btn-group {
        display: flex;
        gap: 2px;
      }
      .btn-sm {
        padding: 6px 10px;
        font-size: 13px;
      }
      .usage-chart {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        flex: 1;
        min-height: 200px;
        padding-bottom: 24px;
        margin: 16px 0;
      }
      .chart-bar-wrapper {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        min-width: 0;
        position: relative;
      }
      .chart-bar-wrapper:hover .chart-tooltip {
        display: block;
      }
      .chart-bar-container {
        flex: 1;
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      .chart-bar {
        width: 100%;
        background: rgba(59, 130, 246, 0.6);
        border-radius: 3px 3px 0 0;
        min-height: 2px;
        transition: height 0.3s ease;
      }
      .chart-bar-stacked {
        width: 100%;
        display: flex;
        flex-direction: column;
        border-radius: 3px 3px 0 0;
        overflow: hidden;
      }
      .chart-segment {
        width: 100%;
        min-height: 1px;
        transition: height 0.3s ease;
      }
      .chart-bar-wrapper:hover .chart-bar,
      .chart-bar-wrapper:hover .chart-segment {
        filter: brightness(1.1);
      }
      .chart-bar-label {
        font-size: 10px;
        color: var(--text-muted, #888);
        margin-top: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .chart-tooltip {
        display: none;
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 8px;
        background: var(--bg-elevated, #1e1e2e);
        border: 1px solid var(--border-color, #333);
        border-radius: 8px;
        padding: 10px 12px;
        min-width: 160px;
        max-width: 220px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        z-index: 100;
        pointer-events: none;
      }
      .chart-tooltip-header {
        font-weight: 500;
        font-size: 12px;
        margin-bottom: 6px;
        color: var(--text-primary, #fff);
        border-bottom: 1px solid var(--border-subtle, #2a2a3a);
        padding-bottom: 6px;
      }
      .chart-tooltip-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        padding: 2px 0;
        gap: 8px;
      }
      .chart-tooltip-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .chart-tooltip-label {
        color: var(--text-secondary, #aaa);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chart-tooltip-value {
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary, #fff);
      }
      .usage-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 20px;
        margin: 16px 0;
        font-size: 13px;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .legend-label {
        color: var(--text-secondary, #aaa);
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .legend-value {
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary, #fff);
      }
      .usage-footer {
        font-size: 12px;
        color: var(--text-muted, #888);
        margin-top: auto;
        padding-top: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pricing-trigger {
        position: relative;
        display: inline-block;
      }
      .pricing-link {
        color: var(--text-secondary, #aaa);
        text-decoration: underline;
        text-decoration-style: dotted;
        cursor: help;
      }
      .pricing-tooltip {
        display: none;
        position: absolute;
        bottom: 100%;
        left: 0;
        margin-bottom: 8px;
        background: var(--bg-elevated, #1e1e2e);
        border: 1px solid var(--border-color, #333);
        border-radius: 8px;
        padding: 12px;
        min-width: 280px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        z-index: 100;
      }
      .pricing-trigger:hover .pricing-tooltip {
        display: block;
      }
      .pricing-tooltip-title {
        font-weight: 500;
        margin-bottom: 8px;
        color: var(--text-primary, #fff);
      }
      .pricing-row {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        padding: 3px 0;
        border-bottom: 1px solid var(--border-subtle, #2a2a3a);
      }
      .pricing-row:last-child {
        border-bottom: none;
      }
      .pricing-model {
        color: var(--text-secondary, #aaa);
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pricing-rates {
        color: var(--text-muted, #888);
        font-variant-numeric: tabular-nums;
      }
      .pricing-unknown {
        font-style: italic;
        opacity: 0.6;
      }
      .usage-loading,
      .usage-empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted, #888);
        min-height: 200px;
      }
    </style>
  `;
}

function truncateLabel(label: string): string {
  if (label.length <= 24) return label;
  const parts = label.split("/");
  if (parts.length > 1) {
    return "…/" + parts[parts.length - 1].slice(0, 18);
  }
  return label.slice(0, 21) + "…";
}
