import { html, nothing } from "lit";
import type { ToolCard } from "../types/chat-types.ts";
import { icons } from "../icons.ts";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.ts";
import { TOOL_INLINE_THRESHOLD } from "./constants.ts";
import { extractTextCached } from "./message-extract.ts";
import { isToolResultMessage } from "./message-normalizer.ts";
import { formatToolOutputForSidebar, getTruncatedPreview } from "./tool-helpers.ts";

export function extractToolCards(message: unknown): ToolCard[] {
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];

  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    const isToolCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (isToolCall) {
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args: coerceArgs(item.arguments ?? item.args),
      });
    }
  }

  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    if (kind !== "toolresult" && kind !== "tool_result") {
      continue;
    }
    const text = extractToolText(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    cards.push({ kind: "result", name, text });
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractTextCached(message) ?? undefined;
    cards.push({ kind: "result", name, text });
  }

  return cards;
}

export function renderToolCardSidebar(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  // Legacy function - delegates to new renderToolCard with expanded=true
  return renderToolCard(card, { expanded: true, onOpenSidebar });
}

export type ToolCardRenderOpts = {
  expanded: boolean;
  onToggle?: () => void;
  onOpenSidebar?: (content: string) => void;
};

export function renderToolCard(card: ToolCard, opts: ToolCardRenderOpts) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());

  const canOpenSidebar = Boolean(opts.onOpenSidebar);
  const handleSidebarClick = canOpenSidebar
    ? (e: Event) => {
        e.stopPropagation();
        if (hasText) {
          opts.onOpenSidebar!(formatToolOutputForSidebar(card.text!));
          return;
        }
        const info = `## ${display.label}\n\n${
          detail ? `**Command:** \`${detail}\`\n\n` : ""
        }*No output — tool completed successfully.*`;
        opts.onOpenSidebar!(info);
      }
    : undefined;

  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const isEmpty = !hasText;
  const isExpandable = hasText && !isShort;

  // Collapse indicator icon
  const chevronIcon = html`
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.15s ease; transform: rotate(${opts.expanded ? "90" : "0"}deg);">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `;

  const handleHeaderClick =
    isExpandable && opts.onToggle
      ? (e: Event) => {
          e.stopPropagation();
          opts.onToggle!();
        }
      : undefined;

  return html`
    <div
      class="chat-tool-card ${isExpandable ? "chat-tool-card--expandable" : ""} ${opts.expanded ? "chat-tool-card--expanded" : ""}"
    >
      <div
        class="chat-tool-card__header ${isExpandable ? "chat-tool-card__header--clickable" : ""}"
        @click=${handleHeaderClick}
        role=${isExpandable ? "button" : nothing}
        tabindex=${isExpandable ? "0" : nothing}
        @keydown=${
          isExpandable
            ? (e: KeyboardEvent) => {
                if (e.key !== "Enter" && e.key !== " ") {
                  return;
                }
                e.preventDefault();
                opts.onToggle?.();
              }
            : nothing
        }
      >
        <div class="chat-tool-card__title">
          ${isExpandable ? html`<span class="chat-tool-card__chevron">${chevronIcon}</span>` : nothing}
          <span class="chat-tool-card__icon">${icons[display.icon]}</span>
          <span>${display.label}</span>
        </div>
        <div class="chat-tool-card__actions">
          ${
            canOpenSidebar
              ? html`<button
                  class="chat-tool-card__sidebar-btn"
                  @click=${handleSidebarClick}
                  title="Open in sidebar"
                >${icons.link}</button>`
              : nothing
          }
          ${isEmpty ? html`<span class="chat-tool-card__status">${icons.check}</span>` : nothing}
        </div>
      </div>
      ${detail && opts.expanded ? html`<div class="chat-tool-card__detail">${detail}</div>` : nothing}
      ${
        isEmpty
          ? html`
              <div class="chat-tool-card__status-text muted">Completed</div>
            `
          : nothing
      }
      ${
        isExpandable && opts.expanded
          ? html`<div class="chat-tool-card__content mono">${card.text}</div>`
          : nothing
      }
      ${
        isExpandable && !opts.expanded
          ? html`<div class="chat-tool-card__preview mono">${getTruncatedPreview(card.text!)}</div>`
          : nothing
      }
      ${isShort ? html`<div class="chat-tool-card__inline mono">${card.text}</div>` : nothing}
    </div>
  `;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(Boolean) as Array<Record<string, unknown>>;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return undefined;
}
