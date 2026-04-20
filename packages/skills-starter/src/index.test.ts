import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import { findSkillByCommand, importExternalSkill, loadStarterSkills } from "./index.js";

describe("starter skills", () => {
  it("loads the curated starter skill pack", async () => {
    const pack = await loadStarterSkills();
    expect(pack.skills).toHaveLength(6);
    expect(pack.skills.map((skill) => skill.metadata.command)).toContain("/plan");
  });

  it("imports external skill markdown into Kimicode format", async () => {
    const cwd = await createTempWorkspace();
    const skillPath = join(cwd, "external-skill.md");
    await writeFile(
      skillPath,
      `---
name: External Review
description: Review external output.
command: /external-review
tags:
  - review
---

This is an imported skill.
`,
      "utf8"
    );

    const skill = await importExternalSkill(skillPath);
    expect(skill.metadata.command).toBe("/external-review");
    expect(skill.body).toContain("imported skill");
  });

  it("finds a starter skill by slash command", async () => {
    const pack = await loadStarterSkills();
    const skill = findSkillByCommand(pack, "/review");

    expect(skill?.metadata.name).toBe("Code Review");
  });
});
