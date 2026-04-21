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

const cacheDir = mkdtempSync(join(tmpdir(), "kimicode-npm-cache-"));

for (const packagePath of packages) {
  const cwd = resolve(root, packagePath);
  const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`npm pack dry-run failed for ${packagePath}`);
  }

  const parsed = JSON.parse(result.stdout);
  const summary = parsed[0];
  process.stdout.write(
    `${summary.name}@${summary.version}: ${summary.entryCount} files, unpacked ${summary.unpackedSize} bytes\n`
  );
}
