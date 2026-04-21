import type {
  KimicodeConfig,
  ProviderAdapter,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  RunTaskOptions,
  RunTaskResult,
  RuntimeHooks,
  SessionSnapshot,
  ToolSpec
} from "./types.js";
import type { ModelRegistry } from "./models.js";
import type { SessionManager } from "./session-manager.js";

export interface RuntimeToolExecutor {
  listToolSpecs(): ToolSpec[];
  executeToolCall(
    callName: string,
    rawArguments: string,
    hooks: RuntimeHooks,
    session: SessionSnapshot
  ): Promise<{ content: string; approved: boolean }>;
}

interface AccumulatedToolCall {
  id: string;
  type: "function" | "builtin_function";
  name: string;
  arguments: string;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Kimicode, a Kimi-first coding agent. Prefer safe, inspectable steps, preserve reasoning continuity across tool loops, and explain what changed.";

export class KimicodeRuntime {
  public constructor(
    private readonly config: KimicodeConfig,
    private readonly registry: ModelRegistry,
    private readonly provider: ProviderAdapter,
    private readonly sessions: SessionManager,
    private readonly tools: RuntimeToolExecutor
  ) {}

  public async runTask(options: RunTaskOptions, hooks: RuntimeHooks = {}): Promise<RunTaskResult> {
    const model = this.registry.resolve(options.modelId ?? this.config.defaultModel);
    const existing = options.sessionId ? await this.sessions.loadSession(options.sessionId) : null;
    const session =
      existing ??
      (await this.sessions.createSession(model.id, (options.title ?? options.prompt.slice(0, 80)) || "Kimicode session"));

    if (session.messages.length === 0) {
      const systemMessage: ProviderMessage = {
        role: "system",
        content: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
      };
      await this.sessions.appendMessage(session, "system", systemMessage);
    }

    const userMessage: ProviderMessage = {
      role: "user",
      content: options.prompt
    };

    hooks.onEvent?.({
      id: crypto.randomUUID(),
      sessionId: session.sessionId,
      timestamp: new Date().toISOString(),
      type: "session.started",
      data: {
        sessionId: session.sessionId,
        modelId: model.id
      }
    });

    await this.sessions.appendMessage(session, "user", userMessage);

    const warnings: string[] = [];
    let assistantText = "";
    let steps = 0;

    while (steps < this.config.maxToolSteps) {
      steps += 1;

      const request: ProviderRequest = {
        model,
        messages: session.messages,
        tools: this.tools.listToolSpecs(),
        toolChoice: "auto",
        promptCacheKey: session.sessionId,
        thinkingEnabled: model.defaultThinking
      };

      const response =
        options.stream === false ? await this.provider.complete(request) : await this.streamResponse(request, hooks);

      for (const warning of response.warnings) {
        warnings.push(warning);
        const event = {
          id: crypto.randomUUID(),
          sessionId: session.sessionId,
          timestamp: new Date().toISOString(),
          type: "warning" as const,
          data: { message: warning }
        };
        hooks.onEvent?.(event);
        await this.sessions.appendEvent(session, "warning", { message: warning });
      }

      await this.sessions.appendMessage(session, "assistant", response.message);

      if (typeof response.message.content === "string") {
        assistantText = response.message.content;
      }

      if (!response.message.toolCalls || response.message.toolCalls.length === 0) {
        await this.sessions.updateStatus(session, "completed");
        return {
          session,
          assistantText,
          warnings
        };
      }

      for (const toolCall of response.message.toolCalls) {
        hooks.onEvent?.({
          id: crypto.randomUUID(),
          sessionId: session.sessionId,
          timestamp: new Date().toISOString(),
          type: "tool.call",
          data: {
            toolName: toolCall.name,
            arguments: toolCall.arguments
          }
        });

        await this.sessions.appendEvent(session, "tool.call", {
          toolName: toolCall.name,
          arguments: toolCall.arguments
        });

        const result = await this.tools.executeToolCall(toolCall.name, toolCall.arguments, hooks, session);
        const toolMessage: ProviderMessage = {
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: result.content
        };

        if (!result.approved) {
          hooks.onEvent?.({
            id: crypto.randomUUID(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            type: "approval.resolved",
            data: {
              toolName: toolCall.name,
              approved: false
            }
          });
        } else {
          hooks.onEvent?.({
            id: crypto.randomUUID(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            type: "approval.resolved",
            data: {
              toolName: toolCall.name,
              approved: true
            }
          });
        }

        await this.sessions.appendMessage(session, "tool", toolMessage);
      }
    }

    await this.sessions.updateStatus(session, "errored");
    throw new Error(`Exceeded maximum tool steps for session ${session.sessionId}`);
  }

  private async streamResponse(request: ProviderRequest, hooks: RuntimeHooks): Promise<ProviderResponse> {
    const toolCalls = new Map<number, AccumulatedToolCall>();
    let content = "";
    let reasoningContent = "";
    const warnings: string[] = [];
    let usage: ProviderResponse["usage"];

    for await (const chunk of this.provider.stream(request)) {
      if (chunk.type === "content" && chunk.content) {
        content += chunk.content;
        hooks.onToken?.(chunk.content);
      }

      if (chunk.type === "reasoning" && chunk.content) {
        reasoningContent += chunk.content;
      }

      if (chunk.type === "warning" && chunk.message) {
        warnings.push(chunk.message);
      }

      if (chunk.type === "tool-call" && chunk.toolCall) {
        const current = toolCalls.get(chunk.toolCall.index) ?? {
          id: chunk.toolCall.id ?? `tool-call-${chunk.toolCall.index}`,
          type: chunk.toolCall.type ?? "function",
          name: chunk.toolCall.name ?? "",
          arguments: ""
        };

        current.id = chunk.toolCall.id ?? current.id;
        current.type = chunk.toolCall.type ?? current.type;
        current.name = chunk.toolCall.name ?? current.name;
        current.arguments += chunk.toolCall.argumentsPart ?? "";
        toolCalls.set(chunk.toolCall.index, current);
      }

      if (chunk.type === "done") {
        usage = chunk.usage;
      }
    }

    const message: ProviderMessage = {
      role: "assistant",
      content
    };

    if (reasoningContent) {
      message.reasoningContent = reasoningContent;
    }

    if (toolCalls.size > 0) {
      message.toolCalls = [...toolCalls.values()];
    }

    const response: ProviderResponse = {
      modelId: request.model.id,
      message,
      warnings
    };

    if (usage) {
      response.usage = usage;
    }

    return response;
  }
}
