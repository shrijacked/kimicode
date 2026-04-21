import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "/Users/owlxshri/Desktop/personal projects/kimicode";

describe("community files", () => {
  it("ships security and conduct policies", async () => {
    const security = await readFile(join(root, "SECURITY.md"), "utf8");
    const conduct = await readFile(join(root, "CODE_OF_CONDUCT.md"), "utf8");

    expect(security).toContain("# Security Policy");
    expect(security).toContain("rotate");
    expect(conduct).toContain("# Code Of Conduct");
    expect(conduct).toContain("harassment");
  });

  it("ships GitHub issue and PR templates", async () => {
    const bug = await readFile(join(root, ".github/ISSUE_TEMPLATE/bug_report.md"), "utf8");
    const feature = await readFile(join(root, ".github/ISSUE_TEMPLATE/feature_request.md"), "utf8");
    const config = await readFile(join(root, ".github/ISSUE_TEMPLATE/config.yml"), "utf8");
    const pr = await readFile(join(root, ".github/pull_request_template.md"), "utf8");

    expect(config).toContain("blank_issues_enabled: false");
    expect(bug).toContain("Do not include real API keys");
    expect(feature).toContain("## Proposed solution");
    expect(pr).toContain("pnpm pack:dry-run");
  });
});
