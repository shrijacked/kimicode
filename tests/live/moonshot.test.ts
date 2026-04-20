import { describe, expect, it } from "vitest";
import { ModelRegistry } from "@kimicode/core";
import { MoonshotProvider } from "@kimicode/provider-moonshot";

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
});
