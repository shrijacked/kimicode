import { describe, expect, it } from "vitest";
import { ModelRegistry } from "@kimicode/core";
import { loadStarterSkills } from "@kimicode/skills-starter";
import { routePromptInput, type PromptRouteContext } from "./runtime-input.js";

const createContext = async (): Promise<PromptRouteContext> => {
  const registry = new ModelRegistry();

  return {
    cwd: "/workspace/demo",
    storageDir: "/workspace/demo/.kimicode",
    approvalMode: "workspace-write",
    defaultModelId: "kimi-k2.6",
    sessionCount: 3,
    models: registry.list(),
    skillPack: await loadStarterSkills()
  };
};

describe("routePromptInput", () => {
  it("returns local status output for /status", async () => {
    const route = routePromptInput("/status", await createContext());

    expect(route.kind).toBe("local");
    if (route.kind === "local") {
      expect(route.output).toContain('"sessionCount": 3');
      expect(route.output).toContain('"command": "/plan"');
    }
  });

  it("routes workflow commands into model-backed prompts", async () => {
    const route = routePromptInput("/review focus on regression risk", await createContext());

    expect(route.kind).toBe("model");
    if (route.kind === "model") {
      expect(route.title).toBe("Code Review workflow");
      expect(route.prompt).toContain("focus on regression risk");
      expect(route.systemPrompt).toContain("Workflow: Code Review");
      expect(route.systemPrompt).toContain("User focus: focus on regression risk");
    }
  });

  it("reports unknown models without touching the provider", async () => {
    const route = routePromptInput("/model not-a-real-model", await createContext());

    expect(route.kind).toBe("local");
    if (route.kind === "local") {
      expect(route.output).toContain("Unknown model: not-a-real-model");
      expect(route.output).toContain("kimi-k2.6");
    }
  });
});
