export type ApprovalMode = "read-only" | "workspace-write" | "full-auto";
export type SessionStatus = "active" | "completed" | "errored";
export type ProviderRole = "system" | "user" | "assistant" | "tool";
export type ToolKind = "local" | "builtin";
export type ToolChoice = "auto" | "none";

export interface CapabilityFlags {
  streaming: boolean;
  toolCalls: boolean;
  thinking: boolean;
  multimodal: boolean;
  builtinWebSearch: boolean;
  builtinCodeRunner: boolean;
}

export interface ModelConstraints {
  allowedToolChoiceWhileThinking: readonly ToolChoice[];
  preserveReasoningContentInToolLoop: boolean;
  builtinWebSearchNeedsThinkingDisabled: boolean;
}

export interface ModelManifest {
  id: string;
  provider: "moonshot";
  displayName: string;
  description: string;
  maxContextTokens: number;
  defaultThinking: boolean;
  capabilities: CapabilityFlags;
  constraints: ModelConstraints;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  imageUrl: string;
}

export interface VideoContentPart {
  type: "video_url";
  videoUrl: string;
}

export type ContentPart = TextContentPart | ImageContentPart | VideoContentPart;

export interface ProviderToolCall {
  id: string;
  type: "function" | "builtin_function";
  name: string;
  arguments: string;
}

export interface ProviderMessage {
  role: ProviderRole;
  content: string | ContentPart[];
  name?: string;
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
  reasoningContent?: string;
  partial?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: Record<string, unknown>;
  requiresWriteAccess?: boolean;
  requiresConfirmation?: boolean;
  destructive?: boolean;
  builtinName?: string;
}

export interface ProviderRequest {
  model: ModelManifest;
  messages: ProviderMessage[];
  tools?: ToolSpec[];
  toolChoice?: ToolChoice;
  maxCompletionTokens?: number;
  promptCacheKey?: string;
  thinkingEnabled?: boolean;
}

export interface ProviderResponse {
  modelId: string;
  message: ProviderMessage;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
  };
  warnings: string[];
}

export interface ProviderStreamChunk {
  type: "content" | "reasoning" | "tool-call" | "done";
  content?: string;
  toolCall?: {
    index: number;
    id?: string;
    type?: "function" | "builtin_function";
    name?: string;
    argumentsPart?: string;
  };
  usage?: ProviderResponse["usage"];
}

export interface ProviderAdapter {
  readonly providerId: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}

export interface TranscriptEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type:
    | "session.started"
    | "session.completed"
    | "user.message"
    | "assistant.message"
    | "assistant.delta"
    | "tool.call"
    | "tool.result"
    | "approval.requested"
    | "approval.resolved"
    | "warning"
    | "error"
    | "status";
  data: Record<string, unknown>;
}

export interface SessionRecord {
  sessionId: string;
  title: string;
  modelId: string;
  cwd: string;
  transcriptPath: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  sessionId: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>;
}

export interface SessionSnapshot extends SessionRecord {
  messages: ProviderMessage[];
  lastAssistantMessage?: string;
  pendingApproval?: ApprovalRequest | null;
}

export interface ExportedSession {
  session: SessionSnapshot;
  transcript: TranscriptEvent[];
}

export interface SkillMetadata {
  name: string;
  slug: string;
  description: string;
  command: string;
  tags: string[];
}

export interface SkillDocument {
  metadata: SkillMetadata;
  body: string;
  sourcePath?: string;
}

export interface SkillPackManifest {
  packName: string;
  version: string;
  skills: SkillDocument[];
}

export interface KimicodeConfig {
  cwd: string;
  storageDir: string;
  defaultModel: string;
  approvalMode: ApprovalMode;
  enableBuiltinTools: boolean;
  maxToolSteps: number;
}

export interface RuntimeHooks {
  onEvent?: (event: TranscriptEvent) => void;
  onToken?: (token: string) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
}

export interface RunTaskOptions {
  prompt: string;
  sessionId?: string;
  title?: string;
  modelId?: string;
  stream?: boolean;
  systemPrompt?: string;
}

export interface RunTaskResult {
  session: SessionSnapshot;
  assistantText: string;
  warnings: string[];
}
