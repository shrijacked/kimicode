import type { ModelManifest } from "./types.js";

const DEFAULT_CONSTRAINTS = {
  allowedToolChoiceWhileThinking: ["auto", "none"] as const,
  preserveReasoningContentInToolLoop: true,
  builtinWebSearchNeedsThinkingDisabled: true
};

export const DEFAULT_MODELS: ModelManifest[] = [
  {
    id: "kimi-k2.6",
    provider: "moonshot",
    displayName: "Kimi K2.6",
    description: "Default coding model with 256K context and multimodal support.",
    maxContextTokens: 256_000,
    defaultThinking: true,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: true,
      multimodal: true,
      builtinWebSearch: true,
      builtinCodeRunner: false,
      officialTools: true
    },
    constraints: DEFAULT_CONSTRAINTS
  },
  {
    id: "kimi-k2-thinking",
    provider: "moonshot",
    displayName: "Kimi K2 Thinking",
    description: "Long-thinking model tuned for deep multi-step reasoning.",
    maxContextTokens: 256_000,
    defaultThinking: true,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: true,
      multimodal: false,
      builtinWebSearch: true,
      builtinCodeRunner: false,
      officialTools: true
    },
    constraints: DEFAULT_CONSTRAINTS
  },
  {
    id: "kimi-k2-thinking-turbo",
    provider: "moonshot",
    displayName: "Kimi K2 Thinking Turbo",
    description: "Faster long-thinking model with the same tool loop rules.",
    maxContextTokens: 256_000,
    defaultThinking: true,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: true,
      multimodal: false,
      builtinWebSearch: true,
      builtinCodeRunner: false,
      officialTools: true
    },
    constraints: DEFAULT_CONSTRAINTS
  },
  {
    id: "kimi-k2-turbo-preview",
    provider: "moonshot",
    displayName: "Kimi K2 Turbo Preview",
    description: "Fast preview model for agent loops when latency matters.",
    maxContextTokens: 256_000,
    defaultThinking: false,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: false,
      multimodal: false,
      builtinWebSearch: true,
      builtinCodeRunner: false,
      officialTools: true
    },
    constraints: {
      allowedToolChoiceWhileThinking: ["auto", "none"],
      preserveReasoningContentInToolLoop: false,
      builtinWebSearchNeedsThinkingDisabled: false
    }
  },
  {
    id: "kimi-k2-0905-preview",
    provider: "moonshot",
    displayName: "Kimi K2 0905 Preview",
    description: "Stable preview model for long-running coding sessions.",
    maxContextTokens: 256_000,
    defaultThinking: false,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: false,
      multimodal: false,
      builtinWebSearch: true,
      builtinCodeRunner: false,
      officialTools: true
    },
    constraints: {
      allowedToolChoiceWhileThinking: ["auto", "none"],
      preserveReasoningContentInToolLoop: false,
      builtinWebSearchNeedsThinkingDisabled: false
    }
  }
];

export class ModelRegistry {
  private readonly models = new Map<string, ModelManifest>();
  private readonly defaultModelId: string;

  public constructor(models: ModelManifest[] = DEFAULT_MODELS, defaultModelId = "kimi-k2.6") {
    for (const model of models) {
      this.models.set(model.id, model);
    }

    if (!this.models.has(defaultModelId)) {
      throw new Error(`Unknown default model: ${defaultModelId}`);
    }

    this.defaultModelId = defaultModelId;
  }

  public list(): ModelManifest[] {
    return [...this.models.values()];
  }

  public get(id: string): ModelManifest {
    const model = this.models.get(id);

    if (!model) {
      throw new Error(`Unknown model: ${id}`);
    }

    return model;
  }

  public resolve(id?: string): ModelManifest {
    return this.get(id ?? this.defaultModelId);
  }

  public defaultModel(): ModelManifest {
    return this.get(this.defaultModelId);
  }
}
