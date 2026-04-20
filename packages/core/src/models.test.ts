import { describe, expect, it } from "vitest";
import { ModelRegistry } from "./models.js";

describe("ModelRegistry", () => {
  it("resolves the default Kimi model", () => {
    const registry = new ModelRegistry();
    expect(registry.defaultModel().id).toBe("kimi-k2.6");
  });

  it("throws on unknown model ids", () => {
    const registry = new ModelRegistry();
    expect(() => registry.get("missing-model")).toThrow("Unknown model");
  });
});
