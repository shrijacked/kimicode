import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const parseArgs = (argv) => {
  const args = [...argv];
  const options = {
    root: defaultRoot,
    dryRun: false
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

    throw new Error(`Unexpected argument: ${current}`);
  }

  return options;
};

const { root, dryRun } = parseArgs(process.argv.slice(2));
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const versionTag = `v${rootPackage.version}`;
const gitStatus = spawnSync("git", ["status", "--short"], {
  cwd: root,
  encoding: "utf8"
});

if (gitStatus.status !== 0) {
  throw new Error(gitStatus.stderr || "Unable to inspect git status.");
}

if (dryRun) {
  const suffix = gitStatus.stdout.trim().length > 0 ? " (working tree currently dirty)" : "";
  process.stdout.write(`Would create tag ${versionTag}${suffix}\n`);
  process.exit(0);
}

if (gitStatus.stdout.trim().length > 0) {
  throw new Error("Refusing to tag with a dirty working tree.");
}

const existingTag = spawnSync("git", ["tag", "-l", versionTag], {
  cwd: root,
  encoding: "utf8"
});

if (existingTag.stdout.trim() === versionTag) {
  throw new Error(`Tag already exists: ${versionTag}`);
}

const tagResult = spawnSync("git", ["tag", "-a", versionTag, "-m", `release: ${versionTag}`], {
  cwd: root,
  encoding: "utf8"
});

if (tagResult.status !== 0) {
  throw new Error(tagResult.stderr || `Failed to create tag ${versionTag}`);
}

process.stdout.write(`Created ${versionTag}\n`);
