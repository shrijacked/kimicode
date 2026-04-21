import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KimicodeRuntime, ModelRegistry, SessionManager, type KimicodeConfig } from "@kimicode/core";
import { MoonshotProvider } from "@kimicode/provider-moonshot";
import { createTempWorkspace } from "@kimicode/testkit";
import { ToolManager } from "@kimicode/tools";

const maybeApiKey = process.env.MOONSHOT_API_KEY;

describe.skipIf(!maybeApiKey)("live Moonshot smoke", () => {
  it("completes a basic Kimi request", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: maybeApiKey as string
    });

    const response = await provider.complete({
      model: registry.defaultModel(),
      messages: [{ role: "user", content: "Reply with exactly ok" }]
    });

    expect(typeof response.message.content).toBe("string");
    expect((response.message.content as string).toLowerCase()).toContain("ok");
  }, 60_000);

  it("supports custom function tool calls", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: maybeApiKey as string
    });

    const response = await provider.complete({
      model: registry.defaultModel(),
      messages: [
        {
          role: "user",
          content:
            'Call the echo_value function exactly once with {"value":"ok"} and do not answer normally before the tool call.'
        }
      ],
      tools: [
        {
          name: "echo_value",
          description: "Echo a short value for smoke-testing tool calls.",
          kind: "local",
          inputSchema: {
            type: "object",
            properties: {
              value: { type: "string" }
            },
            required: ["value"]
          }
        }
      ]
    });

    expect(response.message.toolCalls?.[0]?.name).toBe("echo_value");
  }, 60_000);

  it("emits streamed warnings when builtin web search is filtered for thinking models", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: maybeApiKey as string
    });

    const warnings: string[] = [];
    let text = "";

    for await (const chunk of provider.stream({
      model: registry.defaultModel(),
      messages: [{ role: "user", content: "Reply with exactly ok" }],
      tools: [
        {
          name: "builtin_web_search",
          description: "search",
          kind: "builtin",
          builtinName: "$web_search",
          inputSchema: {}
        }
      ]
    })) {
      if (chunk.type === "warning" && chunk.message) {
        warnings.push(chunk.message);
      }

      if (chunk.type === "content" && chunk.content) {
        text += chunk.content;
      }
    }

    expect(warnings[0]).toContain("Built-in web search was disabled");
    expect(text.toLowerCase()).toContain("ok");
  }, 60_000);

  it("resumes a saved session against the live API", async () => {
    const cwd = await createTempWorkspace("kimicode-live-");
    await writeFile(join(cwd, "README.md"), "# Live session fixture\n", "utf8");

    const config: KimicodeConfig = {
      cwd,
      storageDir: join(cwd, ".kimicode"),
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 4
    };

    const registry = new ModelRegistry();
    const sessions = await SessionManager.create(config);
    const tools = new ToolManager(config);
    const provider = new MoonshotProvider({
      apiKey: maybeApiKey as string
    });
    const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);

    const first = await runtime.runTask(
      {
        prompt: "Reply with exactly alpha",
        stream: false
      },
      {}
    );

    const second = await runtime.runTask(
      {
        prompt: "Reply with exactly beta",
        sessionId: first.session.sessionId,
        stream: false
      },
      {}
    );

    const resumed = await sessions.loadSession(first.session.sessionId);

    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(typeof second.assistantText).toBe("string");
    expect(second.assistantText.toLowerCase()).toContain("beta");
    expect(resumed?.messages.length).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
