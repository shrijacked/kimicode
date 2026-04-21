import { describe, expect, it } from "vitest";
import { ModelRegistry, type ProviderRequest } from "@kimicode/core";
import { MoonshotOfficialToolClient, MoonshotProvider } from "./index.js";

describe("MoonshotProvider", () => {
  it("maps a completion response into provider output", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "kimi-k2.6",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Done",
                  reasoning_content: "reasoning"
                }
              }
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15
            }
          })
        )
    });

    const response = await provider.complete({
      model: registry.defaultModel(),
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(response.message.content).toBe("Done");
    expect(response.message.reasoningContent).toBe("reasoning");
    expect(response.usage?.totalTokens).toBe(15);
  });

  it("disables builtin web search for thinking models and streams deltas", async () => {
    const registry = new ModelRegistry();
    const calls: string[] = [];
    const provider = new MoonshotProvider({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        calls.push(String(init?.body));
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            'data: [DONE]\n\n'
          ].join(""),
          {
            headers: {
              "Content-Type": "text/event-stream"
            }
          }
        );
      }
    });

    const request: ProviderRequest = {
      model: registry.defaultModel(),
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          name: "builtin_web_search",
          description: "search",
          kind: "builtin",
          builtinName: "$web_search",
          inputSchema: {}
        }
      ]
    };

    const chunks: string[] = [];
    const warnings: string[] = [];
    for await (const chunk of provider.stream(request)) {
      if (chunk.type === "content" && chunk.content) {
        chunks.push(chunk.content);
      }

      if (chunk.type === "warning" && chunk.message) {
        warnings.push(chunk.message);
      }
    }

    expect(chunks.join("")).toBe("Hello");
    expect(calls[0]).not.toContain("$web_search");
    expect(warnings).toEqual([
      "Built-in web search was disabled for kimi-k2.6 because the selected model expects thinking mode to be disabled when using $web_search."
    ]);
  });

  it("includes Moonshot API error details for failed completions", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: "bad-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid API key",
              type: "authentication_error"
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
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toThrow("Moonshot request failed with 401 Unauthorized: Invalid API key");
  });

  it("includes Moonshot API error details for failed streaming requests", async () => {
    const registry = new ModelRegistry();
    const provider = new MoonshotProvider({
      apiKey: "bad-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid API key",
              type: "authentication_error"
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

    const collect = async (): Promise<void> => {
      for await (const _chunk of provider.stream({
        model: registry.defaultModel(),
        messages: [{ role: "user", content: "Hi" }]
      })) {
        void _chunk;
      }
    };

    await expect(collect()).rejects.toThrow("Moonshot streaming request failed with 401 Unauthorized: Invalid API key");
  });
});

describe("MoonshotOfficialToolClient", () => {
  it("loads official tools from formula URIs and normalizes shorthand inputs", async () => {
    const calls: string[] = [];
    const client = new MoonshotOfficialToolClient({
      apiKey: "test-key",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            tools: [
              {
                type: "function",
                function: {
                  name: "web_search",
                  description: "Search the web",
                  parameters: {
                    type: "object",
                    properties: {
                      query: {
                        type: "string"
                      }
                    }
                  }
                }
              }
            ]
          })
        );
      }
    });

    const tools = await client.loadTools(["web-search"]);

    expect(calls).toEqual(["https://api.moonshot.ai/v1/formulas/moonshot/web-search:latest/tools"]);
    expect(tools).toEqual([
      {
        name: "web_search",
        description: "Search the web",
        kind: "official",
        formulaUri: "moonshot/web-search:latest",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string"
            }
          }
        }
      }
    ]);
  });

  it("rejects official tool name conflicts across formulas", async () => {
    const client = new MoonshotOfficialToolClient({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            tools: [
              {
                type: "function",
                function: {
                  name: "shared_tool",
                  description: "Conflict",
                  parameters: {
                    type: "object",
                    properties: {}
                  }
                }
              }
            ]
          })
        )
    });

    await expect(client.loadTools(["moonshot/fetch:latest", "moonshot/date:latest"])).rejects.toThrow(
      "Moonshot official tool name conflict: shared_tool appears in both moonshot/fetch:latest and moonshot/date:latest"
    );
  });

  it("executes official tools and prefers encrypted outputs when present", async () => {
    const requests: string[] = [];
    const client = new MoonshotOfficialToolClient({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        requests.push(String(init?.body));
        return new Response(
          JSON.stringify({
            status: "succeeded",
            context: {
              encrypted_output: "----MOONSHOT ENCRYPTED BEGIN----abc----MOONSHOT ENCRYPTED END----",
              output: "plain text"
            }
          })
        );
      }
    });

    const result = await client.callTool(
      {
        name: "web_search",
        description: "Search the web",
        kind: "official",
        formulaUri: "moonshot/web-search:latest",
        inputSchema: {}
      },
      JSON.stringify({ query: "kimicode" })
    );

    expect(requests).toEqual(['{"name":"web_search","arguments":"{\\"query\\":\\"kimicode\\"}"}']);
    expect(result).toContain("MOONSHOT ENCRYPTED");
  });
});
