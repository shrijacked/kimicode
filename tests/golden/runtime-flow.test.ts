import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KimicodeRuntime, ModelRegistry, SessionManager, type KimicodeConfig } from "@kimicode/core";
import { ToolManager } from "@kimicode/tools";
import { FakeProvider, createTempWorkspace } from "@kimicode/testkit";

describe("golden runtime flow", () => {
  it("runs a tool loop and stores a resumable session", async () => {
    const cwd = await createTempWorkspace();
    await writeFile(join(cwd, "README.md"), "Project title", "utf8");

    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: false,
      officialToolFormulas: [],
      maxToolSteps: 4
    };

    const registry = new ModelRegistry();
    const sessions = await SessionManager.create(config);
    const tools = new ToolManager(config);
    const provider = new FakeProvider([
      {
        modelId: "kimi-k2.6",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" })
            }
          ]
        },
        warnings: []
      },
      {
        modelId: "kimi-k2.6",
        message: {
          role: "assistant",
          content: "The README starts with Project title."
        },
        warnings: []
      }
    ]);

    const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);
    const result = await runtime.runTask({
      prompt: "Tell me what the README says.",
      stream: false
    });

    expect(result.assistantText).toContain("Project title");
    const resumed = await sessions.loadSession(result.session.sessionId);
    expect(resumed?.messages.length).toBeGreaterThanOrEqual(4);
    expect(resumed?.lastAssistantMessage).toContain("Project title");
  });

  it("persists the system prompt across resumed runs", async () => {
    const cwd = await createTempWorkspace();

    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: false,
      officialToolFormulas: [],
      maxToolSteps: 4
    };

    const registry = new ModelRegistry();
    const sessions = await SessionManager.create(config);
    const tools = new ToolManager(config);
    const provider = new FakeProvider([
      {
        modelId: "kimi-k2.6",
        message: {
          role: "assistant",
          content: "First pass complete."
        },
        warnings: []
      },
      {
        modelId: "kimi-k2.6",
        message: {
          role: "assistant",
          content: "Second pass complete."
        },
        warnings: []
      }
    ]);

    const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);
    const first = await runtime.runTask({
      prompt: "Inspect the workspace.",
      stream: false
    });

    await runtime.runTask({
      prompt: "Continue from the previous session.",
      sessionId: first.session.sessionId,
      stream: false
    });

    const resumed = await sessions.loadSession(first.session.sessionId);

    expect(resumed?.messages[0]?.role).toBe("system");
    expect(resumed?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("surfaces provider warnings during streamed runs", async () => {
    const cwd = await createTempWorkspace();

    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: false,
      officialToolFormulas: [],
      maxToolSteps: 4
    };

    const registry = new ModelRegistry();
    const sessions = await SessionManager.create(config);
    const tools = new ToolManager(config);
    const provider = new FakeProvider([], [
      {
        type: "warning",
        message: "Built-in web search was disabled for this session."
      },
      {
        type: "content",
        content: "Streamed answer."
      },
      {
        type: "done"
      }
    ]);

    const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);
    const result = await runtime.runTask({
      prompt: "Explain the runtime warnings.",
      stream: true
    });

    expect(result.warnings).toEqual(["Built-in web search was disabled for this session."]);

    const resumed = await sessions.loadSession(result.session.sessionId);
    const transcript = await sessions.exportSession(result.session.sessionId);
    expect(resumed?.lastAssistantMessage).toBe("Streamed answer.");
    expect(transcript?.transcript.some((event) => event.type === "warning")).toBe(true);
  });
});
