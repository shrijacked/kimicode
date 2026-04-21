import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempWorkspace } from "@kimicode/testkit";
import { runCli } from "../../apps/kimicode-cli/src/cli.js";

const readConsoleOutput = (log: ReturnType<typeof vi.spyOn>): string =>
  log.mock.calls
    .map((call) => call.map((value) => String(value)).join(" "))
    .join("\n");

describe("runCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints doctor output without requiring an API key", async () => {
    const cwd = await createTempWorkspace();
    const previousApiKey = process.env.MOONSHOT_API_KEY;
    delete process.env.MOONSHOT_API_KEY;

    try {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCli(["node", "kimicode", "doctor"], { cwd });

      const output = readConsoleOutput(log);
      const doctor = JSON.parse(output) as { hasMoonshotApiKey: boolean; starterSkillCount: number; cwd: string };

      expect(doctor.hasMoonshotApiKey).toBe(false);
      expect(doctor.starterSkillCount).toBe(6);
      expect(doctor.cwd).toBe(cwd);
    } finally {
      process.env.MOONSHOT_API_KEY = previousApiKey;
    }
  });

  it("writes a starter config file for config init", async () => {
    const cwd = await createTempWorkspace();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "kimicode", "config", "init"], { cwd });

    const output = readConsoleOutput(log);
    expect(output).toContain("Wrote");

    const configPath = join(cwd, "kimicode.config.json");
    const raw = await readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual({
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: false,
      officialToolFormulas: [
        "moonshot/web-search:latest",
        "moonshot/fetch:latest",
        "moonshot/date:latest",
        "moonshot/code_runner:latest"
      ],
      maxToolSteps: 6
    });
  });

  it("reports when export is requested before any sessions exist", async () => {
    const cwd = await createTempWorkspace();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "kimicode", "export"], { cwd });

    expect(readConsoleOutput(log)).toContain("No saved sessions found.");
  });

  it("runs local slash commands without requiring the API", async () => {
    const cwd = await createTempWorkspace();
    const previousApiKey = process.env.MOONSHOT_API_KEY;
    delete process.env.MOONSHOT_API_KEY;

    try {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCli(["node", "kimicode", "run", "/status"], { cwd });

      const output = readConsoleOutput(log);
      expect(output).toContain('"sessionCount": 0');
      expect(output).toContain('"command": "/review"');
    } finally {
      process.env.MOONSHOT_API_KEY = previousApiKey;
    }
  });

  it("lists configured tool surfaces without requiring the API", async () => {
    const cwd = await createTempWorkspace();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "kimicode", "tools"], { cwd });

    const output = readConsoleOutput(log);
    const tools = JSON.parse(output) as {
      builtinTools: string[];
      localTools: string[];
      officialTools: {
        enabled: boolean;
        formulas: string[];
        resolved: null | Array<{ name: string; formulaUri?: string }>;
      };
    };

    expect(tools.localTools).toContain("read_file");
    expect(tools.builtinTools).toEqual([]);
    expect(tools.officialTools.enabled).toBe(false);
    expect(tools.officialTools.formulas).toHaveLength(0);
    expect(tools.officialTools.resolved).toBe(null);
  });

  it("resolves official tools when explicitly requested", async () => {
    const cwd = await createTempWorkspace();
    const previousApiKey = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = "test-key";

    try {
      await writeFile(
        join(cwd, "kimicode.config.json"),
        JSON.stringify(
          {
            defaultModel: "kimi-k2.6",
            approvalMode: "workspace-write",
            enableBuiltinTools: false,
            enableOfficialTools: true,
            officialToolFormulas: [
              "moonshot/web-search:latest",
              "moonshot/fetch:latest",
              "moonshot/date:latest",
              "moonshot/code_runner:latest"
            ],
            maxToolSteps: 6
          },
          null,
          2
        ),
        "utf8"
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCli(["node", "kimicode", "tools", "--resolve-official"], {
        cwd,
        loadOfficialTools: async (formulaUris) => [
          {
            name: "web_search",
            description: "Search the web",
            kind: "official",
            formulaUri: formulaUris[0],
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      });

      const output = readConsoleOutput(log);
      const tools = JSON.parse(output) as {
        officialTools: {
          enabled: boolean;
          formulas: string[];
          resolved: Array<{ name: string; formulaUri?: string }>;
        };
      };

      expect(tools.officialTools.formulas).toEqual([
        "moonshot/web-search:latest",
        "moonshot/fetch:latest",
        "moonshot/date:latest",
        "moonshot/code_runner:latest"
      ]);
      expect(tools.officialTools.resolved).toEqual([
        {
          name: "web_search",
          formulaUri: "moonshot/web-search:latest"
        }
      ]);
    } finally {
      process.env.MOONSHOT_API_KEY = previousApiKey;
    }
  });

  it("enables official tools through the config command", async () => {
    const cwd = await createTempWorkspace();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "kimicode", "config", "official-tools", "--enable"], { cwd });

    const output = readConsoleOutput(log);
    expect(output).toContain('"enabled": true');

    const raw = await readFile(join(cwd, "kimicode.config.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      enableOfficialTools: true
    });
  });

  it("adds and removes official tool formulas through the config command", async () => {
    const cwd = await createTempWorkspace();
    await writeFile(
      join(cwd, "kimicode.config.json"),
      JSON.stringify(
        {
          defaultModel: "kimi-k2.6",
          approvalMode: "workspace-write",
          enableBuiltinTools: false,
          enableOfficialTools: true,
          officialToolFormulas: ["moonshot/web-search:latest"],
          maxToolSteps: 6
        },
        null,
        2
      ),
      "utf8"
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "kimicode", "config", "official-tools", "--add-formula", "fetch"], { cwd });
    await runCli(["node", "kimicode", "config", "official-tools", "--remove-formula", "web-search"], { cwd });

    const raw = await readFile(join(cwd, "kimicode.config.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      enableOfficialTools: true,
      officialToolFormulas: ["moonshot/fetch:latest"]
    });

    const output = readConsoleOutput(log);
    expect(output).toContain("moonshot/fetch:latest");
  });
});
