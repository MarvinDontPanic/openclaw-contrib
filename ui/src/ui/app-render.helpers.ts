import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "./app-view-state";
import type { ToolDisplayMode } from "./storage";
import type { ThemeMode } from "./theme";
import type { ThemeTransitionContext } from "./theme-transition";
import type { SessionsListResult } from "./types";
import { refreshChat } from "./app-chat";
import { syncUrlWithSessionKey } from "./app-settings";
import { loadChatHistory } from "./controllers/chat";
import { getModelsForProvider } from "./controllers/model-switcher";
import { icons } from "./icons";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation";

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

export function renderChatControls(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
  );
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const toolDisplayMode: ToolDisplayMode = state.onboarding
    ? "off"
    : state.settings.toolDisplayMode;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  return html`
    <div class="chat-controls">
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          ?disabled=${!state.connected}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            state.sessionKey = next;
            state.chatMessage = "";
            state.chatStream = null;
            state.chatStreamStartedAt = null;
            state.chatRunId = null;
            state.resetToolStream();
            state.resetChatScroll();
            state.applySettings({
              ...state.settings,
              sessionKey: next,
              lastActiveSessionKey: next,
            });
            void state.loadAssistantIdentity();
            syncUrlWithSessionKey(state, next, true);
            void loadChatHistory(state);
          }}
        >
          ${repeat(
            sessionOptions,
            (entry) => entry.key,
            (entry) =>
              html`<option value=${entry.key}>
                ${entry.displayName ?? entry.key}
              </option>`,
          )}
        </select>
      </label>
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${() => {
          state.resetToolStream();
          void refreshChat(state as unknown as Parameters<typeof refreshChat>[0]);
        }}
        title="Refresh chat data"
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${toolDisplayMode !== "off" ? "active" : ""} ${toolDisplayMode === "collapsed" ? "partial" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          // Cycle: off -> collapsed -> full -> off
          const nextMode: ToolDisplayMode =
            toolDisplayMode === "off"
              ? "collapsed"
              : toolDisplayMode === "collapsed"
                ? "full"
                : "off";
          // Reset per-tool overrides when changing global mode
          state.chatExpandedTools = new Set();
          state.applySettings({
            ...state.settings,
            toolDisplayMode: nextMode,
          });
        }}
        aria-pressed=${toolDisplayMode !== "off"}
        title=${
          disableThinkingToggle
            ? "Disabled during onboarding"
            : `Tool display: ${toolDisplayMode} (click to cycle)`
        }
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${
          disableFocusToggle
            ? "Disabled during onboarding"
            : "Toggle focus mode (hide sidebar + page header)"
        }
      >
        ${focusIcon}
      </button>
    </div>
  `;
}

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

function resolveSessionDisplayName(key: string, row?: SessionsListResult["sessions"][number]) {
  const label = row?.label?.trim();
  if (label) {
    return `${label} (${key})`;
  }
  const displayName = row?.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return key;
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain),
    });
  }

  // Add current session key next
  if (!seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

function formatRateLimitReset(resetAt: number | undefined): string {
  if (!resetAt) return "";
  const now = Date.now();
  const diff = resetAt - now;
  if (diff <= 0) return "now";
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    return `${hours}h ${mins % 60}m`;
  }
  return `${mins}m`;
}

export function renderRateLimitIndicator(state: AppViewState) {
  const status = state.rateLimitStatus;

  // Get rate limit info - only show for providers with actual rate limits
  // A window is meaningful if it has: usedPercent > 0 (consumed quota) OR resetAt (time-based quota)
  // This excludes pay-per-token/unlimited providers while including fresh quotas
  let remainingPercent: number | null = null;

  const hasMeaningfulQuota = (w: { usedPercent: number; resetAt?: number }) =>
    w.usedPercent > 0 || w.resetAt !== undefined;

  if (status?.providers?.length) {
    // Find a provider with meaningful quota (consumed some OR has a reset time)
    const activeProvider = status.providers.find((p) => p.windows?.some(hasMeaningfulQuota));
    if (activeProvider) {
      const window = activeProvider.windows.find(hasMeaningfulQuota);
      if (window) {
        remainingPercent = Math.round(100 - window.usedPercent);
      }
    }
  }

  // If we have nothing to show, return empty
  if (remainingPercent === null) {
    return html`
      
    `;
  }

  // Build tooltip rows - include providers with meaningful quotas
  const tooltipRows =
    status?.providers
      ?.filter((p) => p.windows?.some(hasMeaningfulQuota))
      .map((p) => {
        const w = p.windows.find(hasMeaningfulQuota) ?? p.windows[0];
        const pct = Math.round(100 - (w?.usedPercent ?? 0));
        const reset = formatRateLimitReset(w?.resetAt);
        return { name: p.displayName, pct, reset };
      }) ?? [];

  return html`
    <span class="status-divider">·</span>
    <span class="rate-limit-info">
      <span class="rate-limit-stat">${state.runningModel ?? "no model"}</span>
      <span class="status-divider">·</span>
      <span class="rate-limit-stat">⏱ ${remainingPercent}%</span>
      ${
        tooltipRows.length > 0
          ? html`
        <div class="rate-limit-tooltip">
          <div class="rate-limit-tooltip-row">
            <span class="rate-limit-tooltip-name">Model</span>
            <span class="rate-limit-tooltip-pct">${state.runningProvider}/${state.runningModel}</span>
          </div>
          ${tooltipRows.map(
            (row) => html`
            <div class="rate-limit-tooltip-row">
              <span class="rate-limit-tooltip-name">${row.name}</span>
              <span class="rate-limit-tooltip-pct">${row.pct}% left</span>
              ${row.reset ? html`<span class="rate-limit-tooltip-reset">(resets ${row.reset})</span>` : ""}
            </div>
          `,
          )}
        </div>
      `
          : ""
      }
    </span>
  `;
}

export function renderModelSwitcher(state: AppViewState) {
  const providers = state.modelSwitcherProviders;
  const selectedProvider = state.selectedProvider;
  const selectedModel = state.selectedModel;
  const isDirty = state.modelConfigDirty;
  const isSaving = state.modelSwitcherSaving;
  const isLoading = state.modelSwitcherLoading;

  // If no providers configured, show nothing
  if (!providers.length && !isLoading) {
    return html`
      
    `;
  }

  // Get models for the selected provider
  const { favorites, others } = selectedProvider
    ? getModelsForProvider(state, selectedProvider)
    : { favorites: [], others: [] };

  // Format billing indicator: $ for pay-per-use
  const getBillingIndicator = (billingType: string) => {
    if (billingType === "pay-per-use") return " $";
    return "";
  };

  return html`
    <div class="model-switcher ${isDirty ? "model-switcher--dirty" : ""}">
      <!-- Provider dropdown -->
      <select
        class="model-switcher__provider"
        .value=${selectedProvider ?? ""}
        ?disabled=${isLoading || isSaving || !state.connected}
        @change=${(e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          state.handleProviderChange(value);
        }}
        aria-label="Select provider"
      >
        ${
          !selectedProvider
            ? html`
                <option value="" disabled>Provider...</option>
              `
            : ""
        }
        ${providers.map(
          (p) => html`
          <option value=${p.id} ?selected=${p.id === selectedProvider}>
            ${p.displayName}${getBillingIndicator(p.billingType)}${p.authStatus !== "ok" && p.authStatus !== "static" ? ` (${p.authStatus})` : ""}
          </option>
        `,
        )}
      </select>

      <!-- Model dropdown - uses raw model IDs -->
      <select
        class="model-switcher__model"
        .value=${selectedModel ?? ""}
        ?disabled=${isLoading || isSaving || !state.connected || !selectedProvider}
        @change=${(e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          state.handleModelChange(value);
        }}
        aria-label="Select model"
      >
        ${
          !selectedModel
            ? html`
                <option value="" disabled>Model...</option>
              `
            : ""
        }
        ${
          favorites.length > 0
            ? html`
          <optgroup label="★ Favorites">
            ${favorites.map(
              (m) => html`
              <option value=${m.id} ?selected=${m.id === selectedModel}>
                ${m.id}
              </option>
            `,
            )}
          </optgroup>
        `
            : ""
        }
        ${
          others.length > 0
            ? html`
          <optgroup label="${favorites.length > 0 ? "Other" : "Models"}">
            ${others.map(
              (m) => html`
              <option value=${m.id} ?selected=${m.id === selectedModel}>
                ${m.id}
              </option>
            `,
            )}
          </optgroup>
        `
            : ""
        }
      </select>

      <!-- Restart button (only shown when dirty) -->
      ${
        isDirty
          ? html`
        <button
          class="model-switcher__restart"
          ?disabled=${isSaving || !state.connected}
          @click=${() => state.handleModelSwitcherRestart()}
          title="Save config and restart gateway"
        >
          ${isSaving ? "Restarting..." : "Restart"}
        </button>
      `
          : ""
      }
    </div>
  `;
}

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="Theme">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="System theme"
          title="System"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="Light theme"
          title="Light"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="Dark theme"
          title="Dark"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}
