import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = [
  "apps/kimicode-cli",
  "packages/core",
  "packages/provider-moonshot",
  "packages/tools",
  "packages/skills-starter",
  "packages/testkit"
];

const packDir = mkdtempSync(join(tmpdir(), "kimicode-pack-"));

for (const packagePath of packages) {
  const cwd = resolve(root, packagePath);
  const result = spawnSync("pnpm", ["pack", "--json", "--pack-destination", packDir], {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`npm pack dry-run failed for ${packagePath}`);
  }

  const summary = JSON.parse(result.stdout);
  const manifest = spawnSync("tar", ["-xOf", summary.filename, "package/package.json"], {
    encoding: "utf8"
  });

  if (manifest.status !== 0) {
    process.stderr.write(manifest.stdout || "");
    process.stderr.write(manifest.stderr || "");
    throw new Error(`failed to inspect packed manifest for ${packagePath}`);
  }

  const packedPackage = JSON.parse(manifest.stdout);
  const workspaceDependencies = [
    ...Object.entries(packedPackage.dependencies ?? {}),
    ...Object.entries(packedPackage.optionalDependencies ?? {}),
    ...Object.entries(packedPackage.peerDependencies ?? {})
  ].filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"));

  if (workspaceDependencies.length > 0) {
    throw new Error(`workspace protocol dependencies leaked into the packed manifest for ${packagePath}`);
  }

  process.stdout.write(
    `${summary.name}@${summary.version}: ${summary.files.length} files, packed manifest verified\n`
  );
}
