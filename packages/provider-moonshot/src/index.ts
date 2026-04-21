import type {
  ContentPart,
  ModelManifest,
  ProviderAdapter,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderToolCall,
  ToolSpec
} from "@kimicode/core";

interface MoonshotClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface MoonshotCompletionResponse {
  model: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function" | "builtin_function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
  };
}

const encodeContent = (content: string | ContentPart[]): string | Array<Record<string, unknown>> => {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text
      };
    }

    if (part.type === "image_url") {
      return {
        type: "image_url",
        image_url: {
          url: part.imageUrl
        }
      };
    }

    return {
      type: "video_url",
      video_url: {
        url: part.videoUrl
      }
    };
  });
};

const toMoonshotMessage = (message: ProviderMessage): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    role: message.role,
    content: encodeContent(message.content)
  };

  if (message.role === "assistant" && message.toolCalls) {
    payload.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments
      }
    }));
  }

  if (message.role === "assistant" && message.reasoningContent) {
    payload.reasoning_content = message.reasoningContent;
  }

  if (message.role === "tool") {
    payload.tool_call_id = message.toolCallId;
    payload.name = message.name;
  }

  return payload;
};

const toToolCalls = (
  toolCalls: MoonshotCompletionResponse["choices"][number]["message"]["tool_calls"]
): ProviderToolCall[] | undefined =>
  toolCalls?.map((toolCall) => ({
    id: toolCall.id,
    type: toolCall.type,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments
  }));

const toMoonshotTool = (tool: ToolSpec): Record<string, unknown> => {
  if (tool.kind === "builtin" && tool.builtinName) {
    return {
      type: "builtin_function",
      function: {
        name: tool.builtinName
      }
    };
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  };
};

const normalizeTools = (model: ModelManifest, tools: ToolSpec[] | undefined): { tools: ToolSpec[]; warnings: string[] } => {
  if (!tools || tools.length === 0) {
    return {
      tools: [],
      warnings: []
    };
  }

  const warnings: string[] = [];
  const filtered = tools.filter((tool) => {
    if (
      model.defaultThinking &&
      tool.kind === "builtin" &&
      tool.builtinName === "$web_search" &&
      model.constraints.builtinWebSearchNeedsThinkingDisabled
    ) {
      warnings.push(
        `Built-in web search was disabled for ${model.id} because the selected model expects thinking mode to be disabled when using $web_search.`
      );
      return false;
    }

    return true;
  });

  return {
    tools: filtered,
    warnings
  };
};

const buildRequestBody = (request: ProviderRequest): { body: Record<string, unknown>; warnings: string[] } => {
  const warnings: string[] = [];
  const normalizedTools = normalizeTools(request.model, request.tools);
  warnings.push(...normalizedTools.warnings);

  let toolChoice = request.toolChoice;
  const thinkingEnabled = request.thinkingEnabled ?? request.model.defaultThinking;

  if (thinkingEnabled && toolChoice && !request.model.constraints.allowedToolChoiceWhileThinking.includes(toolChoice)) {
    warnings.push(
      `tool_choice=${toolChoice} is not compatible with thinking mode for ${request.model.id}; falling back to auto.`
    );
    toolChoice = "auto";
  }

  const body: Record<string, unknown> = {
    model: request.model.id,
    messages: request.messages.map(toMoonshotMessage),
    max_completion_tokens: request.maxCompletionTokens ?? 32_768,
    prompt_cache_key: request.promptCacheKey,
    thinking: {
      type: thinkingEnabled ? "enabled" : "disabled"
    }
  };

  if (normalizedTools.tools.length > 0) {
    body.tools = normalizedTools.tools.map(toMoonshotTool);
    body.tool_choice = toolChoice ?? "auto";
  }

  return {
    body,
    warnings
  };
};

async function* parseSseStream(response: Response): AsyncIterable<ProviderStreamChunk> {
  if (!response.body) {
    throw new Error("Moonshot streaming response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n\n")) {
      const separatorIndex = buffer.indexOf("\n\n");
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") {
          yield { type: "done" };
          continue;
        }

        const payload = JSON.parse(dataLine) as Record<string, unknown>;
        const choices = payload.choices as Array<Record<string, unknown>>;
        const choice = choices?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;

        if (!delta) {
          continue;
        }

        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield {
            type: "content",
            content: delta.content
          };
        }

        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
          yield {
            type: "reasoning",
            content: delta.reasoning_content
          };
        }

        const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (deltaToolCalls) {
          for (const toolCall of deltaToolCalls) {
            const fn = toolCall.function as Record<string, unknown> | undefined;
            const streamedToolCall: NonNullable<ProviderStreamChunk["toolCall"]> = {
              index: Number(toolCall.index ?? 0)
            };

            if (typeof toolCall.id === "string") {
              streamedToolCall.id = toolCall.id;
            }

            if (toolCall.type === "builtin_function" || toolCall.type === "function") {
              streamedToolCall.type = toolCall.type;
            }

            if (typeof fn?.name === "string") {
              streamedToolCall.name = fn.name;
            }

            if (typeof fn?.arguments === "string") {
              streamedToolCall.argumentsPart = fn.arguments;
            }

            yield {
              type: "tool-call",
              toolCall: streamedToolCall
            };
          }
        }

        if (choice?.finish_reason && payload.usage) {
          const usage = payload.usage as Record<string, number>;
          const usagePayload: NonNullable<ProviderStreamChunk["usage"]> = {};
          if (typeof usage.prompt_tokens === "number") {
            usagePayload.promptTokens = usage.prompt_tokens;
          }
          if (typeof usage.completion_tokens === "number") {
            usagePayload.completionTokens = usage.completion_tokens;
          }
          if (typeof usage.total_tokens === "number") {
            usagePayload.totalTokens = usage.total_tokens;
          }
          if (typeof usage.cached_tokens === "number") {
            usagePayload.cachedTokens = usage.cached_tokens;
          }
          yield {
            type: "done",
            usage: usagePayload
          };
        }
      }
    }
  }
}

export class MoonshotProvider implements ProviderAdapter {
  public readonly providerId = "moonshot";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  public constructor(private readonly options: MoonshotClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.moonshot.ai/v1";
  }

  public async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const { body, warnings } = buildRequestBody(request);
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Moonshot request failed with ${response.status}`);
    }

    const payload = (await response.json()) as MoonshotCompletionResponse;
    const message = payload.choices[0]?.message;

    if (!message) {
      throw new Error("Moonshot response did not include a message.");
    }

    const providerMessage: ProviderMessage = {
      role: "assistant",
      content: message.content
    };

    const toolCalls = toToolCalls(message.tool_calls);
    if (toolCalls) {
      providerMessage.toolCalls = toolCalls;
    }

    if (message.reasoning_content) {
      providerMessage.reasoningContent = message.reasoning_content;
    }

    const providerResponse: ProviderResponse = {
      modelId: payload.model,
      message: providerMessage,
      warnings
    };

    if (payload.usage) {
      const usage: NonNullable<ProviderResponse["usage"]> = {};
      if (typeof payload.usage.prompt_tokens === "number") {
        usage.promptTokens = payload.usage.prompt_tokens;
      }
      if (typeof payload.usage.completion_tokens === "number") {
        usage.completionTokens = payload.usage.completion_tokens;
      }
      if (typeof payload.usage.total_tokens === "number") {
        usage.totalTokens = payload.usage.total_tokens;
      }
      if (typeof payload.usage.cached_tokens === "number") {
        usage.cachedTokens = payload.usage.cached_tokens;
      }
      providerResponse.usage = usage;
    }

    return providerResponse;
  }

  public async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const { body, warnings } = buildRequestBody(request);

    for (const warning of warnings) {
      yield {
        type: "warning",
        message: warning
      };
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...body,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Moonshot streaming request failed with ${response.status}`);
    }

    yield* parseSseStream(response);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.apiKey}`,
      "Content-Type": "application/json"
    };
  }
}
