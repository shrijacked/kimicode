import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import type { KimicodeConfig, SessionSnapshot } from "@kimicode/core";
import { ToolManager } from "./index.js";

const makeSession = (cwd: string): SessionSnapshot => ({
  sessionId: "session-1",
  title: "test",
  modelId: "kimi-k2.6",
  cwd,
  transcriptPath: join(cwd, ".kimicode", "sessions", "session-1", "transcript.jsonl"),
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: []
});

describe("ToolManager", () => {
  it("reads files and applies patches", async () => {
    const cwd = await createTempWorkspace();
    await writeFile(join(cwd, "notes.txt"), "hello world", "utf8");
    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 4
    };

    const manager = new ToolManager(config);
    const session = makeSession(cwd);

    const readResult = await manager.executeToolCall("read_file", JSON.stringify({ path: "notes.txt" }), {}, session);
    expect(readResult.content).toContain("hello world");

    await manager.executeToolCall(
      "write_patch",
      JSON.stringify({
        path: "notes.txt",
        operations: [{ search: "world", replace: "kimicode" }]
      }),
      {},
      session
    );

    const patched = await manager.executeToolCall("read_file", JSON.stringify({ path: "notes.txt" }), {}, session);
    expect(patched.content).toContain("hello kimicode");
  });

  it("blocks destructive shell commands when approval is denied", async () => {
    const cwd = await createTempWorkspace();
    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 4
    };
    const manager = new ToolManager(config);
    const session = makeSession(cwd);

    await expect(
      manager.executeToolCall(
        "shell",
        JSON.stringify({ command: "rm -rf build" }),
        {
          requestApproval: async () => false
        },
        session
      )
    ).rejects.toThrow("Approval denied");
  });

  it("lists and executes configured official tools", async () => {
    const cwd = await createTempWorkspace();
    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: true,
      officialToolFormulas: ["moonshot/date:latest"],
      maxToolSteps: 4
    };
    const manager = new ToolManager(config, {
      officialTools: [
        {
          name: "date_time",
          description: "Get the current date and time.",
          kind: "official",
          formulaUri: "moonshot/date:latest",
          inputSchema: {
            type: "object",
            properties: {
              timezone: { type: "string" }
            }
          }
        }
      ],
      executeOfficialTool: async (_spec, rawArguments) => `executed:${rawArguments}`
    });
    const session = makeSession(cwd);

    expect(manager.listToolSpecs().some((tool) => tool.name === "date_time")).toBe(true);

    const result = await manager.executeToolCall(
      "date_time",
      JSON.stringify({ timezone: "Asia/Kolkata" }),
      {},
      session
    );

    expect(result).toEqual({
      content: 'executed:{"timezone":"Asia/Kolkata"}',
      approved: true
    });
  });
});
