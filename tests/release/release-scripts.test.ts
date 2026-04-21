import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";

const execFile = promisify(execFileCallback);
const repoRoot = "/Users/owlxshri/Desktop/personal projects/kimicode";

const workspacePackages = [
  "package.json",
  "apps/kimicode-cli/package.json",
  "packages/core/package.json",
  "packages/provider-moonshot/package.json",
  "packages/tools/package.json",
  "packages/skills-starter/package.json",
  "packages/testkit/package.json"
];

const makePackableWorkspace = async (): Promise<string> => {
  const root = await createTempWorkspace("kimicode-release-test-");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", version: "0.1.0" }, null, 2));

  const packagePayloads: Array<[string, Record<string, unknown>]> = [
    [
      "apps/kimicode-cli/package.json",
      {
        name: "kimicode",
        version: "0.1.0",
        type: "module",
        bin: {
          kimicode: "dist/index.js"
        },
        files: ["dist"]
      }
    ],
    [
      "packages/core/package.json",
      {
        name: "@kimicode/core",
        version: "0.1.0",
        type: "module",
        files: ["dist"],
        exports: {
          ".": {
            import: "./dist/index.js"
          }
        }
      }
    ],
    [
      "packages/provider-moonshot/package.json",
      {
        name: "@kimicode/provider-moonshot",
        version: "0.1.0",
        type: "module",
        files: ["dist"],
        exports: {
          ".": {
            import: "./dist/index.js"
          }
        }
      }
    ],
    [
      "packages/tools/package.json",
      {
        name: "@kimicode/tools",
        version: "0.1.0",
        type: "module",
        files: ["dist"],
        exports: {
          ".": {
            import: "./dist/index.js"
          }
        }
      }
    ],
    [
      "packages/skills-starter/package.json",
      {
        name: "@kimicode/skills-starter",
        version: "0.1.0",
        type: "module",
        files: ["dist", "skills"],
        exports: {
          ".": {
            import: "./dist/index.js"
          }
        }
      }
    ],
    [
      "packages/testkit/package.json",
      {
        name: "@kimicode/testkit",
        version: "0.1.0",
        type: "module",
        files: ["dist"],
        exports: {
          ".": {
            import: "./dist/index.js"
          }
        }
      }
    ]
  ];

  for (const [relativePath, payload] of packagePayloads) {
    const packagePath = join(root, relativePath);
    await mkdir(join(packagePath, ".."), { recursive: true });
    await writeFile(packagePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  const distTargets = [
    "apps/kimicode-cli/dist",
    "packages/core/dist",
    "packages/provider-moonshot/dist",
    "packages/tools/dist",
    "packages/skills-starter/dist",
    "packages/testkit/dist"
  ];

  for (const distTarget of distTargets) {
    const absolute = join(root, distTarget);
    await mkdir(absolute, { recursive: true });
    await writeFile(join(absolute, "index.js"), "export {};\n", "utf8");
  }

  await mkdir(join(root, "packages/skills-starter/skills"), { recursive: true });
  await writeFile(join(root, "packages/skills-starter/skills/plan.md"), "# plan\n", "utf8");

  return root;
};

describe("release scripts", () => {
  it("bumps every workspace package and rolls the changelog", async () => {
    const root = await createTempWorkspace("kimicode-version-test-");

    for (const packagePath of workspacePackages) {
      const absolute = join(root, packagePath);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(
        absolute,
        `${JSON.stringify({ name: packagePath.replace("/package.json", ""), version: "0.1.0" }, null, 2)}\n`,
        "utf8"
      );
    }

    await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- Add release coverage.\n", "utf8");

    await execFile("node", ["scripts/release-version.mjs", "minor", "--root", root, "--date", "2026-04-21"], {
      cwd: repoRoot
    });

    for (const packagePath of workspacePackages) {
      const raw = await readFile(join(root, packagePath), "utf8");
      expect(JSON.parse(raw).version).toBe("0.2.0");
    }

    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## 0.2.0 - 2026-04-21");
    expect(changelog).toContain("- Add release coverage.");
  });

  it("creates a git tag in a clean temp repo", async () => {
    const root = await createTempWorkspace("kimicode-tag-test-");

    await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "kimicode-workspace", version: "1.2.3" }, null, 2)}\n`);
    await execFile("git", ["init"], { cwd: root });
    await execFile("git", ["config", "user.name", "Kimicode Tests"], { cwd: root });
    await execFile("git", ["config", "user.email", "tests@example.com"], { cwd: root });
    await execFile("git", ["add", "package.json"], { cwd: root });
    await execFile("git", ["commit", "-m", "init"], { cwd: root });

    await execFile("node", ["scripts/release-tag.mjs", "--root", root], {
      cwd: repoRoot
    });

    const { stdout } = await execFile("git", ["tag", "-l", "v1.2.3"], { cwd: root });
    expect(stdout.trim()).toBe("v1.2.3");
  });

  it("packs workspace packages in publish order during dry runs", async () => {
    const root = await makePackableWorkspace();

    const { stdout } = await execFile("node", ["scripts/publish-packages.mjs", "--dry-run", "--root", root], {
      cwd: repoRoot
    });

    expect(stdout).toContain("packages/core: @kimicode/core@0.1.0");
    expect(stdout).toContain("packages/provider-moonshot: @kimicode/provider-moonshot@0.1.0");
    expect(stdout).toContain("packages/tools: @kimicode/tools@0.1.0");
    expect(stdout).toContain("packages/skills-starter: @kimicode/skills-starter@0.1.0");
    expect(stdout).toContain("packages/testkit: @kimicode/testkit@0.1.0");
    expect(stdout).toContain("apps/kimicode-cli: kimicode@0.1.0");
  }, 60_000);
});
