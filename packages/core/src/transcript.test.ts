import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import { TranscriptStore } from "./transcript.js";

describe("TranscriptStore", () => {
  it("recovers valid events when the transcript ends with a truncated line", async () => {
    const cwd = await createTempWorkspace();
    const transcriptPath = join(cwd, "transcript.jsonl");

    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          id: "event-1",
          sessionId: "session-1",
          timestamp: "2026-04-21T00:00:00.000Z",
          type: "session.started",
          data: { sessionId: "session-1" }
        }),
        '{"id":"event-2","sessionId":"session-1"'
      ].join("\n"),
      "utf8"
    );

    const store = new TranscriptStore(transcriptPath);
    const events = await store.readAll();

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("event-1");
  });
});
