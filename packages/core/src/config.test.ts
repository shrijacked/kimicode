import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import { loadKimicodeConfig } from "./config.js";

describe("loadKimicodeConfig", () => {
  it("merges file config with defaults", async () => {
    const cwd = await createTempWorkspace();
    await writeFile(
      join(cwd, "kimicode.config.json"),
      JSON.stringify({
        defaultModel: "kimi-k2-thinking",
        approvalMode: "read-only",
        maxToolSteps: 2
      }),
      "utf8"
    );

    const config = await loadKimicodeConfig(cwd);
    expect(config.defaultModel).toBe("kimi-k2-thinking");
    expect(config.approvalMode).toBe("read-only");
    expect(config.maxToolSteps).toBe(2);
    expect(config.storageDir).toContain(".kimicode");
  });
});
