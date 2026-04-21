import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "/Users/owlxshri/Desktop/personal projects/kimicode";

describe("GitHub workflows", () => {
  it("keeps CI wired to verify and package dry-runs", async () => {
    const raw = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");

    expect(raw).toContain("name: CI");
    expect(raw).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(raw).toContain("pnpm verify");
    expect(raw).toContain("pnpm pack:dry-run");
    expect(raw).toContain("node:");
    expect(raw).toContain('          - "20"');
    expect(raw).toContain('          - "22"');
  });

  it("keeps live smoke available as a manual workflow", async () => {
    const raw = await readFile(join(root, ".github/workflows/live-smoke.yml"), "utf8");

    expect(raw).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(raw).toContain("workflow_dispatch:");
    expect(raw).toContain("MOONSHOT_API_KEY");
    expect(raw).toContain("pnpm test:live");
  });
});
