import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePaths = [
  "package.json",
  "apps/kimicode-cli/package.json",
  "packages/core/package.json",
  "packages/provider-moonshot/package.json",
  "packages/tools/package.json",
  "packages/skills-starter/package.json",
  "packages/testkit/package.json"
];

const parseArgs = (argv) => {
  const args = [...argv];
  const options = {
    root: defaultRoot,
    date: new Date().toISOString().slice(0, 10)
  };
  let versionArg = "";

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--root") {
      options.root = resolve(args.shift());
      continue;
    }

    if (current === "--date") {
      options.date = args.shift();
      continue;
    }

    if (!versionArg) {
      versionArg = current;
      continue;
    }

    throw new Error(`Unexpected argument: ${current}`);
  }

  if (!versionArg) {
    throw new Error("Usage: node scripts/release-version.mjs <patch|minor|major|x.y.z> [--root path] [--date YYYY-MM-DD]");
  }

  return {
    ...options,
    versionArg
  };
};

const bumpVersion = (currentVersion, releaseType) => {
  const parts = currentVersion.split(".").map(Number);

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  const [major, minor, patch] = parts;

  switch (releaseType) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      if (!/^\d+\.\d+\.\d+$/.test(releaseType)) {
        throw new Error(`Invalid release target: ${releaseType}`);
      }
      return releaseType;
  }
};

const updatePackageVersion = (packagePath, version) => {
  const raw = readFileSync(packagePath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.version = version;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
};

const updateChangelog = (changelogPath, version, date) => {
  const releaseLine = `## ${version} - ${date}`;
  let raw = "";

  try {
    raw = readFileSync(changelogPath, "utf8");
  } catch {
    raw = "# Changelog\n\n## Unreleased\n\n- No unreleased changes yet.\n";
  }

  if (!raw.includes("## Unreleased")) {
    raw = `# Changelog\n\n## Unreleased\n\n- No unreleased changes yet.\n\n${raw.trim()}\n`;
  }

  const unreleasedMatch = raw.match(/## Unreleased\s+([\s\S]*?)(?:\n## |\s*$)/);
  const unreleasedBody = unreleasedMatch?.[1]?.trim() || "- Release cut.";
  const releaseBody = unreleasedBody === "- No unreleased changes yet." ? "- Release cut." : unreleasedBody;
  const withoutUnreleasedBody = raw.replace(/## Unreleased\s+([\s\S]*?)(?=\n## |\s*$)/, "## Unreleased\n\n- No unreleased changes yet.\n");

  if (withoutUnreleasedBody.includes(releaseLine)) {
    throw new Error(`Changelog already contains ${releaseLine}`);
  }

  const updated = withoutUnreleasedBody.replace(
    "## Unreleased\n\n- No unreleased changes yet.\n",
    `## Unreleased\n\n- No unreleased changes yet.\n\n${releaseLine}\n\n${releaseBody}\n`
  );

  writeFileSync(changelogPath, `${updated.trim()}\n`, "utf8");
};

const { root, date, versionArg } = parseArgs(process.argv.slice(2));
const rootPackagePath = resolve(root, "package.json");
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const nextVersion = bumpVersion(rootPackage.version, versionArg);

for (const packagePath of packagePaths) {
  updatePackageVersion(resolve(root, packagePath), nextVersion);
}

updateChangelog(resolve(root, "CHANGELOG.md"), nextVersion, date);
process.stdout.write(`Updated workspace version to ${nextVersion}\n`);
