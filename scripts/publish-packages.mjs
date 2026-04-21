import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publishOrder = [
  "packages/core",
  "packages/provider-moonshot",
  "packages/tools",
  "packages/skills-starter",
  "packages/testkit",
  "apps/kimicode-cli"
];
const cacheDir = mkdtempSync(join(tmpdir(), "kimicode-npm-cache-"));
const packDir = mkdtempSync(join(tmpdir(), "kimicode-publish-pack-"));

const parseArgs = (argv) => {
  const args = [...argv];
  const options = {
    root: defaultRoot,
    dryRun: false,
    tag: "latest",
    access: "public"
  };

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--root") {
      options.root = resolve(args.shift());
      continue;
    }

    if (current === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (current === "--tag") {
      options.tag = args.shift();
      continue;
    }

    if (current === "--access") {
      options.access = args.shift();
      continue;
    }

    throw new Error(`Unexpected argument: ${current}`);
  }

  return options;
};

const { root, dryRun, tag, access } = parseArgs(process.argv.slice(2));

for (const packagePath of publishOrder) {
  const args = dryRun
    ? ["pack", "--json", "--pack-destination", packDir]
    : ["publish", "--access", access, "--tag", tag, "--no-git-checks"];

  const result = spawnSync("pnpm", args, {
    cwd: resolve(root, packagePath),
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    },
    encoding: "utf8",
    stdio: dryRun ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    if (dryRun) {
      process.stderr.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
    }

    throw new Error(`Publish failed for ${packagePath}`);
  }

  if (dryRun) {
    const packed = JSON.parse(result.stdout);
    process.stdout.write(`${packagePath}: ${packed.name}@${packed.version}\n`);
  }
}
