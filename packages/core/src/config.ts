import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ApprovalMode, KimicodeConfig } from "./types.js";

const fileSchema = z
  .object({
    defaultModel: z.string().optional(),
    approvalMode: z.enum(["read-only", "workspace-write", "full-auto"]).optional(),
    enableBuiltinTools: z.boolean().optional(),
    maxToolSteps: z.number().int().positive().optional(),
    storageDir: z.string().optional()
  })
  .strict();

const approvalModeFromEnv = (value: string | undefined): ApprovalMode | undefined => {
  if (value === "read-only" || value === "workspace-write" || value === "full-auto") {
    return value;
  }

  return undefined;
};

export async function loadKimicodeConfig(cwd = process.cwd()): Promise<KimicodeConfig> {
  const configPath = join(cwd, "kimicode.config.json");
  let fileConfig: z.infer<typeof fileSchema> = {};

  try {
    const raw = await readFile(configPath, "utf8");
    fileConfig = fileSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const storageDir = process.env.KIMICODE_STORAGE_DIR ?? fileConfig.storageDir ?? join(cwd, ".kimicode");
  await mkdir(storageDir, { recursive: true });

  return {
    cwd,
    storageDir,
    defaultModel: process.env.KIMICODE_MODEL ?? fileConfig.defaultModel ?? "kimi-k2.6",
    approvalMode:
      approvalModeFromEnv(process.env.KIMICODE_APPROVAL_MODE) ?? fileConfig.approvalMode ?? "workspace-write",
    enableBuiltinTools: fileConfig.enableBuiltinTools ?? false,
    maxToolSteps: fileConfig.maxToolSteps ?? 6
  };
}
