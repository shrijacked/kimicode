import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import type { KimicodeConfig } from "./types.js";
import { SessionManager } from "./session-manager.js";

describe("SessionManager", () => {
  it("replays stored transcript messages on load", async () => {
    const cwd = await createTempWorkspace();
    const config: KimicodeConfig = {
      cwd,
      storageDir: `${cwd}/.kimicode`,
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 4
    };

    const manager = await SessionManager.create(config);
    const session = await manager.createSession("kimi-k2.6", "Replay test");
    await manager.appendMessage(session, "user", { role: "user", content: "hello" });
    await manager.appendMessage(session, "assistant", { role: "assistant", content: "world" });

    const loaded = await manager.loadSession(session.sessionId);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.lastAssistantMessage).toBe("world");
  });

  it("exports the session snapshot alongside the full transcript", async () => {
    const cwd = await createTempWorkspace();
    const config: KimicodeConfig = {
      cwd,
      storageDir: `${cwd}/.kimicode`,
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 4
    };

    const manager = await SessionManager.create(config);
    const session = await manager.createSession("kimi-k2.6", "Export test");
    await manager.appendMessage(session, "user", { role: "user", content: "inspect repo" });
    await manager.appendMessage(session, "assistant", { role: "assistant", content: "repo inspected" });

    const exported = await manager.exportSession(session.sessionId);

    expect(exported?.session.sessionId).toBe(session.sessionId);
    expect(exported?.session.lastAssistantMessage).toBe("repo inspected");
    expect(exported?.transcript.map((event) => event.type)).toEqual([
      "session.started",
      "user.message",
      "assistant.message"
    ]);
  });
});
