import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KimicodeRuntime, ModelRegistry, SessionManager, type KimicodeConfig } from "@kimicode/core";
import { MoonshotOfficialToolClient, MoonshotProvider } from "@kimicode/provider-moonshot";
import { createTempWorkspace } from "@kimicode/testkit";
import { ToolManager } from "@kimicode/tools";

const maybeApiKey = process.env.MOONSHOT_API_KEY;

const buildSmokeArguments = (schema: Record<string, unknown>): Record<string, unknown> => {
  const properties = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const required = (schema.required as string[] | undefined) ?? [];
  const output: Record<string, unknown> = {};

  for (const field of required) {
    const descriptor = properties[field] ?? {};
    const type = descriptor.type;

    if (/timezone/i.test(field)) {
      output[field] = "UTC";
      continue;
    }

    if (/url/i.test(field)) {
      output[field] = "https://example.com";
      continue;
    }

    if (/query|search/i.test(field)) {
      output[field] = "current UTC time";
      continue;
    }

    switch (type) {
      case "string":
        output[field] = "kimicode";
        break;
      case "integer":
      case "number":
        output[field] = 1;
        break;
      case "boolean":
        output[field] = false;
        break;
      case "array":
        output[field] = [];
        break;
      default:
        output[field] = {};
        break;
    }
  }

  return output;
};

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
      enableOfficialTools: false,
      officialToolFormulas: [],
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

  it("loads and executes an official formula tool", async () => {
    const client = new MoonshotOfficialToolClient({
      apiKey: maybeApiKey as string
    });

    const tools = await client.loadTools(["moonshot/date:latest"]);
    expect(tools.length).toBeGreaterThan(0);

    const tool = tools[0];
    const result = await client.callTool(tool, JSON.stringify(buildSmokeArguments(tool.inputSchema)));

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("MoonshotProvider error diagnostics", () => {
  it("surfaces provider error details when authentication fails", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: "bad-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid API key"
            }
          }),
          {
            status: 401,
            statusText: "Unauthorized",
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
    });

    await expect(
      provider.complete({
        model: registry.defaultModel(),
        messages: [{ role: "user", content: "Reply with exactly ok" }]
      })
    ).rejects.toThrow("Moonshot request failed with 401 Unauthorized: Invalid API key");
  });
});
