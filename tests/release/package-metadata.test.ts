import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "/Users/owlxshri/Desktop/personal projects/kimicode";

interface PackageExpectation {
  path: string;
  expectSkills?: boolean;
  scoped?: boolean;
}

const publishablePackages: PackageExpectation[] = [
  { path: "apps/kimicode-cli/package.json" },
  { path: "packages/core/package.json", scoped: true },
  { path: "packages/provider-moonshot/package.json", scoped: true },
  { path: "packages/tools/package.json", scoped: true },
  { path: "packages/skills-starter/package.json", expectSkills: true, scoped: true },
  { path: "packages/testkit/package.json", scoped: true }
];

describe("package metadata", () => {
  it("keeps the root verify script wired to the main checks", async () => {
    const raw = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.verify).toBe("pnpm build && pnpm test && pnpm lint");
    expect(pkg.scripts?.["pack:dry-run"]).toBe("node scripts/pack-dry-run.mjs");
    expect(pkg.scripts?.["publish:packages"]).toBe("node scripts/publish-packages.mjs");
    expect(pkg.scripts?.["release:check"]).toBe("pnpm verify && pnpm pack:dry-run");
    expect(pkg.scripts?.["release:tag"]).toBe("node scripts/release-tag.mjs");
    expect(pkg.scripts?.["release:version"]).toBe("node scripts/release-version.mjs");
  });

  it("keeps publishable packages ready for packaging", async () => {
    for (const entry of publishablePackages) {
      const raw = await readFile(join(root, entry.path), "utf8");
      const pkg = JSON.parse(raw) as {
        name: string;
        license?: string;
        files?: string[];
        exports?: Record<string, unknown>;
        engines?: Record<string, string>;
        publishConfig?: Record<string, string>;
        bin?: Record<string, string>;
      };

      expect(pkg.license, `${pkg.name} should declare a license`).toBe("MIT");
      expect(pkg.files?.includes("dist"), `${pkg.name} should publish its build output`).toBe(true);
      expect(pkg.engines?.node, `${pkg.name} should pin a Node baseline`).toBe(">=20");

      if (entry.expectSkills) {
        expect(pkg.files?.includes("skills"), `${pkg.name} should include starter skills assets`).toBe(true);
      }

      if (entry.scoped) {
        expect(pkg.exports?.["."], `${pkg.name} should expose a package entrypoint`).toBeDefined();
        expect(pkg.publishConfig?.access, `${pkg.name} should be publishable as public scope`).toBe("public");
      } else {
        expect(pkg.bin?.kimicode, `${pkg.name} should expose the kimicode binary`).toBe("dist/index.js");
      }
    }
  });
});
