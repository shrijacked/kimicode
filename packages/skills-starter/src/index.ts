import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { SkillDocument, SkillMetadata, SkillPackManifest } from "@kimicode/core";

const parseFrontmatter = (raw: string): { metadata: Record<string, unknown>; body: string } => {
  if (!raw.startsWith("---\n")) {
    return {
      metadata: {},
      body: raw
    };
  }

  const closingIndex = raw.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return {
      metadata: {},
      body: raw
    };
  }

  const metadata = YAML.parse(raw.slice(4, closingIndex)) as Record<string, unknown>;
  const body = raw.slice(closingIndex + 5);
  return { metadata, body };
};

const normalizeMetadata = (metadata: Record<string, unknown>, sourcePath: string): SkillMetadata => {
  const name = typeof metadata.name === "string" ? metadata.name : basename(sourcePath, extname(sourcePath));
  const slug =
    typeof metadata.slug === "string"
      ? metadata.slug
      : name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

  return {
    name,
    slug,
    description: typeof metadata.description === "string" ? metadata.description : "",
    command: typeof metadata.command === "string" ? metadata.command : `/${slug}`,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((value): value is string => typeof value === "string") : []
  };
};

export async function loadStarterSkills(): Promise<SkillPackManifest> {
  const root = fileURLToPath(new URL("../skills", import.meta.url));
  const entries = await readdir(root);
  const skillPaths = entries.filter((entry) => entry.endsWith(".md")).sort();
  const skills: SkillDocument[] = [];

  for (const entry of skillPaths) {
    const sourcePath = join(root, entry);
    const raw = await readFile(sourcePath, "utf8");
    const parsed = parseFrontmatter(raw);
    skills.push({
      metadata: normalizeMetadata(parsed.metadata, sourcePath),
      body: parsed.body.trim(),
      sourcePath
    });
  }

  return {
    packName: "kimicode-starter",
    version: "0.1.0",
    skills
  };
}

export async function importExternalSkill(sourcePath: string): Promise<SkillDocument> {
  const raw = await readFile(sourcePath, "utf8");
  const parsed = parseFrontmatter(raw);

  return {
    metadata: normalizeMetadata(parsed.metadata, sourcePath),
    body: parsed.body.trim(),
    sourcePath
  };
}

export function findSkillByCommand(pack: SkillPackManifest, command: string): SkillDocument | undefined {
  return pack.skills.find((skill) => skill.metadata.command === command);
}
