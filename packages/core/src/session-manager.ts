import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { KimicodeConfig, ProviderMessage, SessionRecord, SessionSnapshot, SessionStatus, TranscriptEvent } from "./types.js";
import { TranscriptStore } from "./transcript.js";
import { SessionIndex } from "./session-index.js";

const eventId = () => randomUUID();
const now = () => new Date().toISOString();

const isProviderMessage = (value: unknown): value is ProviderMessage =>
  typeof value === "object" && value !== null && "role" in value && "content" in value;

export class SessionManager {
  private constructor(
    private readonly config: KimicodeConfig,
    private readonly index: SessionIndex
  ) {}

  public static async create(config: KimicodeConfig): Promise<SessionManager> {
    const databasePath = join(config.storageDir, "session-index.sqlite");
    const index = await SessionIndex.open(databasePath);
    return new SessionManager(config, index);
  }

  public async createSession(modelId: string, title: string): Promise<SessionSnapshot> {
    const sessionId = process.env.KIMICODE_SESSION_ID ?? randomUUID();
    const createdAt = now();
    const transcriptPath = join(this.config.storageDir, "sessions", sessionId, "transcript.jsonl");
    const record: SessionRecord = {
      sessionId,
      title,
      modelId,
      cwd: this.config.cwd,
      transcriptPath,
      status: "active",
      createdAt,
      updatedAt: createdAt
    };

    await this.index.upsert(record);

    const transcript = new TranscriptStore(transcriptPath);
    await transcript.append({
      id: eventId(),
      sessionId,
      timestamp: createdAt,
      type: "session.started",
      data: {
        sessionId,
        title,
        modelId,
        cwd: this.config.cwd
      }
    });

    return {
      ...record,
      messages: []
    };
  }

  public async appendEvent(session: SessionSnapshot, type: TranscriptEvent["type"], data: Record<string, unknown>): Promise<void> {
    const timestamp = now();
    const transcript = new TranscriptStore(session.transcriptPath);
    await transcript.append({
      id: eventId(),
      sessionId: session.sessionId,
      timestamp,
      type,
      data
    });

    const updated: SessionRecord = {
      sessionId: session.sessionId,
      title: session.title,
      modelId: session.modelId,
      cwd: session.cwd,
      transcriptPath: session.transcriptPath,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: timestamp
    };

    await this.index.upsert(updated);
    session.updatedAt = timestamp;
  }

  public async appendMessage(session: SessionSnapshot, role: "user" | "assistant" | "tool", message: ProviderMessage): Promise<void> {
    const type = role === "user" ? "user.message" : role === "assistant" ? "assistant.message" : "tool.result";
    await this.appendEvent(session, type, { message });
    session.messages.push(message);

    if (role === "assistant" && typeof message.content === "string") {
      session.lastAssistantMessage = message.content;
    }
  }

  public async updateStatus(session: SessionSnapshot, status: SessionStatus): Promise<void> {
    session.status = status;
    await this.appendEvent(session, "session.completed", { status });
  }

  public listSessions(limit = 20): SessionRecord[] {
    return this.index.list(limit);
  }

  public async loadSession(sessionId: string): Promise<SessionSnapshot | null> {
    const record = this.index.get(sessionId);

    if (!record) {
      return null;
    }

    const transcript = new TranscriptStore(record.transcriptPath);
    const events = await transcript.readAll();
    const messages: ProviderMessage[] = [];
    let lastAssistantMessage: string | undefined;
    let pendingApproval: SessionSnapshot["pendingApproval"] = null;

    for (const event of events) {
      if ((event.type === "user.message" || event.type === "assistant.message" || event.type === "tool.result") && isProviderMessage(event.data.message)) {
        messages.push(event.data.message);
      }

      if (event.type === "assistant.message" && isProviderMessage(event.data.message) && typeof event.data.message.content === "string") {
        lastAssistantMessage = event.data.message.content;
      }

      if (event.type === "approval.requested") {
        pendingApproval = {
          sessionId: record.sessionId,
          toolName: String(event.data.toolName),
          reason: String(event.data.reason),
          input: (event.data.input as Record<string, unknown>) ?? {}
        };
      }

      if (event.type === "approval.resolved") {
        pendingApproval = null;
      }
    }

    const snapshot: SessionSnapshot = {
      ...record,
      messages,
      pendingApproval
    };

    if (lastAssistantMessage) {
      snapshot.lastAssistantMessage = lastAssistantMessage;
    }

    return snapshot;
  }
}
