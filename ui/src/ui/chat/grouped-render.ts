import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity";
import type { ToolDisplayMode } from "../storage";
import type { MessageGroup } from "../types/chat-types";
import { toSanitizedMarkdownHtml } from "../markdown";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer";
import { extractToolCards, renderToolCard } from "./tool-cards";

type ImageBlock = {
  url: string;
  alt?: string;
};

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          // If data is already a data URL, use it directly
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

export function renderReadingIndicatorGroup(assistant?: AssistantIdentity) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false },
          onOpenSidebar,
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${name}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
    toolDisplayMode: ToolDisplayMode;
    expandedTools: Set<string>;
    onToggleTool: (toolId: string) => void;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const who =
    normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // For tool groups in collapsed mode, render as a compact one-liner
  const isToolGroup = normalizedRole === "tool";
  const groupKey = group.messages[0]?.key ?? `group:${group.timestamp}`;
  const isGroupExpanded = opts.expandedTools.has(groupKey);

  // In collapsed mode, tool groups show as one-liner unless explicitly expanded
  // In full mode, tool groups show expanded unless explicitly collapsed
  const shouldCollapseToolGroup =
    isToolGroup &&
    ((opts.toolDisplayMode === "collapsed" && !isGroupExpanded) ||
      (opts.toolDisplayMode === "full" && isGroupExpanded));

  if (isToolGroup && shouldCollapseToolGroup) {
    const toolCount = group.messages.length;
    return html`
      <div 
        class="chat-group tool chat-group--collapsed"
        @click=${() => opts.onToggleTool(groupKey)}
        role="button"
        tabindex="0"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.onToggleTool(groupKey);
          }
        }}
      >
        ${renderAvatar(group.role, {
          name: assistantName,
          avatar: opts.assistantAvatar ?? null,
        })}
        <div class="chat-group-messages chat-group-messages--collapsed">
          <div class="chat-tool-summary">
            <span class="chat-tool-summary__count">${toolCount} tool ${toolCount === 1 ? "call" : "calls"}</span>
            <span class="chat-tool-summary__hint">click to ${opts.toolDisplayMode === "collapsed" ? "expand" : "collapse"}</span>
          </div>
          <div class="chat-group-footer">
            <span class="chat-sender-name">${who}</span>
            <span class="chat-group-timestamp">${timestamp}</span>
          </div>
        </div>
      </div>
    `;
  }

  // For tool groups that should show expanded, add click to collapse
  const toolGroupClickHandler = isToolGroup ? () => opts.onToggleTool(groupKey) : undefined;

  return html`
    <div class="chat-group ${roleClass} ${isToolGroup && !shouldCollapseToolGroup ? "chat-group--expandable" : ""}">
      ${renderAvatar(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${
          isToolGroup
            ? html`
          <div 
            class="chat-tool-header"
            @click=${toolGroupClickHandler}
            role="button"
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toolGroupClickHandler?.();
              }
            }}
          >
            <span class="chat-tool-header__hint">click to ${opts.toolDisplayMode === "collapsed" ? "expand" : "collapse"}</span>
          </div>
        `
            : nothing
        }
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            item.key,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
              toolDisplayMode: opts.toolDisplayMode,
              expandedTools: opts.expandedTools,
              onToggleTool: opts.onToggleTool,
            },
            opts.onOpenSidebar,
          ),
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

function renderAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => window.open(img.url, "_blank")}
          />
        `,
      )}
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  messageKey: string,
  opts: {
    isStreaming: boolean;
    showReasoning: boolean;
    toolDisplayMode: ToolDisplayMode;
    expandedTools: Set<string>;
    onToggleTool: (toolId: string) => void;
  },
  onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  // In "off" mode, don't extract/show tool cards at all
  const toolCards = opts.toolDisplayMode === "off" ? [] : extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;

  const extractedText = extractTextCached(message);
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());

  const bubbleClasses = [
    "chat-bubble",
    canCopyMarkdown ? "has-copy" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  // Determine if this tool card should be expanded based on mode + overrides
  const getToolExpanded = (toolId: string): boolean => {
    const hasOverride = opts.expandedTools.has(toolId);
    if (hasOverride) {
      // If user clicked, invert the default
      return opts.toolDisplayMode === "collapsed";
    }
    // Default based on mode
    return opts.toolDisplayMode === "full";
  };

  if (!markdown && hasToolCards && isToolResult) {
    return html`${toolCards.map((card, idx) => {
      const toolId = `${messageKey}:tool:${idx}`;
      return renderToolCard(card, {
        expanded: getToolExpanded(toolId),
        onToggle: () => opts.onToggleTool(toolId),
        onOpenSidebar,
      });
    })}`;
  }

  if (!markdown && !hasToolCards && !hasImages) {
    return nothing;
  }

  return html`
    <div class="${bubbleClasses}">
      ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown!) : nothing}
      ${renderMessageImages(images)}
      ${
        reasoningMarkdown
          ? html`<div class="chat-thinking">${unsafeHTML(
              toSanitizedMarkdownHtml(reasoningMarkdown),
            )}</div>`
          : nothing
      }
      ${
        markdown
          ? html`<div class="chat-text">${unsafeHTML(toSanitizedMarkdownHtml(markdown))}</div>`
          : nothing
      }
      ${toolCards.map((card, idx) => {
        const toolId = `${messageKey}:tool:${idx}`;
        return renderToolCard(card, {
          expanded: getToolExpanded(toolId),
          onToggle: () => opts.onToggleTool(toolId),
          onOpenSidebar,
        });
      })}
    </div>
  `;
}
