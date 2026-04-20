import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderStreamChunk } from "@kimicode/core";

export class FakeProvider implements ProviderAdapter {
  public readonly providerId = "fake";

  public constructor(
    private readonly completions: ProviderResponse[] = [],
    private readonly streamChunks: ProviderStreamChunk[] = []
  ) {}

  public async complete(_request: ProviderRequest): Promise<ProviderResponse> {
    void _request;
    const next = this.completions.shift();
    if (!next) {
      throw new Error("No fake completion available.");
    }
    return next;
  }

  public async *stream(_request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    void _request;
    for (const chunk of this.streamChunks) {
      yield chunk;
    }
  }
}

export async function createTempWorkspace(prefix = "kimicode-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
