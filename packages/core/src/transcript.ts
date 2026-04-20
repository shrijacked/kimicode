import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TranscriptEvent } from "./types.js";

export class TranscriptStore {
  public constructor(private readonly transcriptPath: string) {}

  public async append(event: TranscriptEvent): Promise<void> {
    await mkdir(dirname(this.transcriptPath), { recursive: true });

    let existing = "";
    try {
      existing = await readFile(this.transcriptPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await writeFile(this.transcriptPath, `${existing}${JSON.stringify(event)}\n`, "utf8");
  }

  public async readAll(): Promise<TranscriptEvent[]> {
    try {
      const raw = await readFile(this.transcriptPath, "utf8");

      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TranscriptEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}
