import type { GatewayBrowserClient } from "../gateway";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

export type ProviderAuthStatus = "ok" | "expiring" | "expired" | "missing" | "static";

export type ProviderBillingType = "prepaid" | "pay-per-use" | "unknown";

export type ProviderInfo = {
  id: string;
  displayName: string;
  authStatus: ProviderAuthStatus;
  authLabel?: string;
  billingType: ProviderBillingType;
};

export type ModelSwitcherState = {
  client: GatewayBrowserClient | null;
  connected: boolean;

  // Data from gateway
  modelSwitcherProviders: ProviderInfo[];
  modelSwitcherModels: ModelCatalogEntry[];

  // User selection (desired state)
  selectedProvider: string | null;
  selectedModel: string | null;

  // Running state (from config)
  runningProvider: string | null;
  runningModel: string | null;

  // UI state
  modelSwitcherLoading: boolean;
  modelSwitcherSaving: boolean;
  modelSwitcherError: string | null;
  modelConfigDirty: boolean;

  // Config hash for safe patching
  configBaseHash: string | null;

  // Curated favorites (from config or hardcoded)
  favoriteModels: string[];
};

// Hardcoded favorites that appear at the top of model lists
// User request: generic names only, no date-specifics, no "claude-4" (only 4.5+)
const DEFAULT_FAVORITES = [
  "claude-opus-4-5",
  "claude-opus-4-5-thinking",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "gpt-4o",
  "gemini-3-pro",
  "gemini-3-pro-thinking-high", // Specific user request
  "gemini-3-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash",
];

// Map provider IDs to display names and billing info
const PROVIDER_INFO: Record<string, { displayName: string; billingType: ProviderBillingType }> = {
  "google-antigravity": { displayName: "AntiGravity", billingType: "prepaid" },
  anthropic: { displayName: "Anthropic", billingType: "pay-per-use" },
  openai: { displayName: "OpenAI", billingType: "pay-per-use" },
  "google-gemini": { displayName: "Google Gemini", billingType: "pay-per-use" },
  "amazon-bedrock": { displayName: "AWS Bedrock", billingType: "pay-per-use" },
  "github-copilot": { displayName: "GitHub Copilot", billingType: "prepaid" },
  ollama: { displayName: "Ollama", billingType: "prepaid" },
  openrouter: { displayName: "OpenRouter", billingType: "pay-per-use" },
};

function getProviderInfo(providerId: string): {
  displayName: string;
  billingType: ProviderBillingType;
} {
  return PROVIDER_INFO[providerId] ?? { displayName: providerId, billingType: "unknown" };
}

function parseModelString(modelString: string): { provider: string; model: string } | null {
  if (!modelString) return null;
  const parts = modelString.split("/");
  if (parts.length === 2) {
    return { provider: parts[0], model: parts[1] };
  }
  // No provider prefix, return as model only
  return { provider: "", model: modelString };
}

function buildModelString(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export async function loadModelSwitcher(state: ModelSwitcherState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }

  state.modelSwitcherLoading = true;
  state.modelSwitcherError = null;

  try {
    // Fetch models, health, and config in parallel
    const [modelsRes, , configRes] = await Promise.all([
      state.client.request("models.list", {}),
      state.client.request("health", {}),
      state.client.request("config.get", {}),
    ]);

    // Extract models
    const modelsPayload = modelsRes as { models?: ModelCatalogEntry[] } | undefined;
    const models = Array.isArray(modelsPayload?.models) ? modelsPayload.models : [];
    state.modelSwitcherModels = models;

    // Get auth profiles and hash from config
    const configPayload = configRes as
      | {
          config?: Record<string, unknown>;
          hash?: string;
        }
      | undefined;
    const config = configPayload?.config ?? {};
    state.configBaseHash = configPayload?.hash ?? null;

    const auth = config.auth as
      | { profiles?: Record<string, { provider: string; mode: string }> }
      | undefined;
    const profiles = auth?.profiles ?? {};

    // Build provider list from auth profiles
    const providerMap = new Map<string, ProviderInfo>();
    for (const [profileId, profile] of Object.entries(profiles)) {
      const providerId = profile.provider;
      if (!providerMap.has(providerId)) {
        const info = getProviderInfo(providerId);
        providerMap.set(providerId, {
          id: providerId,
          displayName: info.displayName,
          authStatus: profile.mode === "api_key" ? "static" : "ok",
          authLabel: profileId,
          billingType: info.billingType,
        });
      }
    }
    state.modelSwitcherProviders = Array.from(providerMap.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );

    // Extract running model from config
    const agents = config.agents as { defaults?: { model?: { primary?: string } } } | undefined;
    const runningModelFull = agents?.defaults?.model?.primary ?? null;

    if (runningModelFull) {
      const parsed = parseModelString(runningModelFull);
      state.runningProvider = parsed?.provider ?? null;
      state.runningModel = parsed?.model ?? null;

      // Initialize selection to running values if not already set
      if (!state.selectedProvider) {
        state.selectedProvider = state.runningProvider;
      }
      if (!state.selectedModel) {
        state.selectedModel = state.runningModel;
      }
    }

    // Set favorites
    state.favoriteModels = DEFAULT_FAVORITES;

    // Update dirty flag
    updateDirtyFlag(state);
  } catch (err) {
    state.modelSwitcherError = String(err);
  } finally {
    state.modelSwitcherLoading = false;
  }
}

export function updateDirtyFlag(state: ModelSwitcherState): void {
  const selectedFull =
    state.selectedProvider && state.selectedModel
      ? buildModelString(state.selectedProvider, state.selectedModel)
      : null;
  const runningFull =
    state.runningProvider && state.runningModel
      ? buildModelString(state.runningProvider, state.runningModel)
      : null;

  state.modelConfigDirty = selectedFull !== runningFull && selectedFull !== null;
}

export function setSelectedProvider(state: ModelSwitcherState, provider: string): void {
  state.selectedProvider = provider;

  // Auto-select first available model for this provider if current selection is invalid
  const modelsForProvider = state.modelSwitcherModels.filter((m) => m.provider === provider);
  const currentModelValid = modelsForProvider.some((m) => m.id === state.selectedModel);

  if (!currentModelValid && modelsForProvider.length > 0) {
    // Prefer a favorite if available
    const favorite = modelsForProvider.find((m) => state.favoriteModels.includes(m.id));
    state.selectedModel = favorite?.id ?? modelsForProvider[0].id;
  }

  updateDirtyFlag(state);
}

export function setSelectedModel(state: ModelSwitcherState, model: string): void {
  state.selectedModel = model;
  updateDirtyFlag(state);
}

export async function saveModelSelection(state: ModelSwitcherState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  if (!state.selectedProvider || !state.selectedModel) {
    state.modelSwitcherError = "No model selected";
    return false;
  }

  state.modelSwitcherSaving = true;
  state.modelSwitcherError = null;

  try {
    const newModelString = buildModelString(state.selectedProvider, state.selectedModel);

    // config.patch requires 'raw' as a JSON string and 'baseHash' for safety
    const patchObject = {
      agents: {
        defaults: {
          model: {
            primary: newModelString,
          },
        },
      },
    };

    await state.client.request("config.patch", {
      raw: JSON.stringify(patchObject),
      baseHash: state.configBaseHash ?? undefined,
      restartDelayMs: 1000, // Give a brief delay before restart
    });

    // The gateway will restart after config.patch (it schedules SIGUSR1 restart)
    // Don't update runningProvider/runningModel yet — that happens after reconnect

    return true;
  } catch (err) {
    state.modelSwitcherError = String(err);
    return false;
  } finally {
    state.modelSwitcherSaving = false;
  }
}

export function getModelsForProvider(
  state: ModelSwitcherState,
  provider: string,
): { favorites: ModelCatalogEntry[]; others: ModelCatalogEntry[] } {
  const all = state.modelSwitcherModels.filter((m) => m.provider === provider);

  const favorites: ModelCatalogEntry[] = [];
  const others: ModelCatalogEntry[] = [];

  for (const model of all) {
    const isFavorite = state.favoriteModels.includes(model.id);
    if (isFavorite) {
      favorites.push(model);
    } else {
      others.push(model);
    }
  }

  // Sort favorites by their order in the favorites list
  favorites.sort((a, b) => {
    const aIndex = state.favoriteModels.indexOf(a.id);
    const bIndex = state.favoriteModels.indexOf(b.id);
    return aIndex - bIndex;
  });

  // Sort others alphabetically by id
  others.sort((a, b) => a.id.localeCompare(b.id));

  return { favorites, others };
}

export function getProviderForModel(state: ModelSwitcherState, modelId: string): string | null {
  const model = state.modelSwitcherModels.find((m) => m.id === modelId);
  return model?.provider ?? null;
}
