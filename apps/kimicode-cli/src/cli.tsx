import { createInterface } from "node:readline/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { render } from "ink";
import React from "react";
import { cac } from "cac";
import {
  BUILTIN_SLASH_COMMANDS,
  KimicodeRuntime,
  ModelRegistry,
  SessionManager,
  loadKimicodeConfig,
  type KimicodeConfig,
  type ApprovalRequest,
  type ToolSpec,
  type TranscriptEvent
} from "@kimicode/core";
import { MoonshotOfficialToolClient, MoonshotProvider } from "@kimicode/provider-moonshot";
import { loadStarterSkills } from "@kimicode/skills-starter";
import { ToolManager } from "@kimicode/tools";
import { App } from "./components/App.js";
import { routePromptInput } from "./runtime-input.js";

interface RuntimeState {
  sessionId: string;
  modelId: string;
  thinkingEnabled: boolean;
  output: string;
  events: TranscriptEvent[];
  status: string;
  error?: string;
}

const DEFAULT_OFFICIAL_TOOL_FORMULAS = [
  "moonshot/web-search:latest",
  "moonshot/fetch:latest",
  "moonshot/date:latest",
  "moonshot/code_runner:latest"
] as const;

export interface CliContext {
  cwd?: string;
  interactivePrompt?: () => Promise<string>;
  approvalPrompter?: (request: ApprovalRequest) => Promise<boolean>;
  loadOfficialTools?: (formulaUris: string[], apiKey: string) => Promise<ToolSpec[]>;
}

const createApprovalPrompter = async (request: ApprovalRequest): Promise<boolean> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await rl.question(`${request.reason}\nApprove ${request.toolName}? [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
};

const requireApiKey = (): string => {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    throw new Error("MOONSHOT_API_KEY is required for model-backed commands.");
  }
  return apiKey;
};

async function runInteractivePrompt(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const prompt = await rl.question("Task> ");
  rl.close();
  return prompt.trim();
}

async function loadOfficialTools(
  config: KimicodeConfig,
  context: CliContext,
  apiKey: string
): Promise<ToolSpec[]> {
  if (!config.enableOfficialTools || config.officialToolFormulas.length === 0) {
    return [];
  }

  if (context.loadOfficialTools) {
    return context.loadOfficialTools(config.officialToolFormulas, apiKey);
  }

  const officialToolClient = new MoonshotOfficialToolClient({
    apiKey
  });

  return officialToolClient.loadTools(config.officialToolFormulas);
}

const buildConfigTemplate = (): string =>
  JSON.stringify(
    {
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      enableOfficialTools: false,
      officialToolFormulas: DEFAULT_OFFICIAL_TOOL_FORMULAS,
      maxToolSteps: 6
    },
    null,
    2
  );

const normalizeOfficialToolFormula = (value: string): string => {
  let normalized = value.trim();

  if (!normalized.includes("/")) {
    normalized = `moonshot/${normalized}`;
  }

  if (!normalized.includes(":")) {
    normalized = `${normalized}:latest`;
  }

  return normalized;
};

async function readProjectConfig(cwd?: string): Promise<Record<string, unknown>> {
  const config = await loadKimicodeConfig(cwd);
  const configPath = join(config.cwd, "kimicode.config.json");

  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return JSON.parse(buildConfigTemplate()) as Record<string, unknown>;
  }
}

async function writeProjectConfig(cwd: string, payload: Record<string, unknown>): Promise<string> {
  const configPath = join(cwd, "kimicode.config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return configPath;
}

async function ensureConfigFile(force = false, cwd?: string): Promise<string> {
  const config = await loadKimicodeConfig(cwd);
  const configPath = join(config.cwd, "kimicode.config.json");

  if (!force) {
    try {
      await readFile(configPath, "utf8");
      return configPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${buildConfigTemplate()}\n`, "utf8");
  return configPath;
}

interface ExecutePromptOptions {
  modelIdOverride?: string;
  sessionId?: string;
}

async function executePrompt(prompt: string, options: ExecutePromptOptions = {}, context: CliContext = {}): Promise<void> {
  const config = await loadKimicodeConfig(context.cwd);
  const registry = new ModelRegistry();
  const skillPack = await loadStarterSkills();
  const sessions = await SessionManager.create(config);
  const sessionCount = sessions.listSessions(5).length;
  const route = routePromptInput(prompt, {
    cwd: config.cwd,
    storageDir: config.storageDir,
    approvalMode: config.approvalMode,
    defaultModelId: config.defaultModel,
    sessionCount,
    models: registry.list(),
    skillPack
  });

  if (route.kind === "local") {
    console.log(route.output);
    return;
  }

  const model = registry.resolve(route.modelId ?? options.modelIdOverride ?? config.defaultModel);
  const apiKey = requireApiKey();
  const provider = new MoonshotProvider({
    apiKey
  });
  const officialToolClient = new MoonshotOfficialToolClient({
    apiKey
  });
  const officialTools = await loadOfficialTools(config, context, apiKey);
  const tools = new ToolManager(config, {
    officialTools,
    executeOfficialTool: async (spec, rawArguments) => officialToolClient.callTool(spec, rawArguments)
  });
  const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);

  const state: RuntimeState = {
    sessionId: options.sessionId ?? "pending",
    modelId: model.id,
    thinkingEnabled: model.defaultThinking,
    output: "",
    events: [],
    status: "starting"
  };

  const instance = render(
    <App
      sessionId={state.sessionId}
      modelId={state.modelId}
      thinkingEnabled={state.thinkingEnabled}
      approvalMode={config.approvalMode}
      output={state.output}
      events={state.events}
      status={state.status}
    />
  );

  const rerender = (): void => {
    const errorProps = state.error ? { error: state.error } : {};
    instance.rerender(
      <App
        sessionId={state.sessionId}
        modelId={state.modelId}
        thinkingEnabled={state.thinkingEnabled}
        approvalMode={config.approvalMode}
        output={state.output}
        events={state.events}
        status={state.status}
        {...errorProps}
      />
    );
  };

  try {
    state.status = "running";
    rerender();

    const runTaskOptions = {
      prompt: route.prompt,
      modelId: model.id,
      stream: true,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(route.systemPrompt ? { systemPrompt: route.systemPrompt } : {}),
      ...(route.title ? { title: route.title } : {})
    };

    const result = await runtime.runTask(runTaskOptions, {
      onToken: (token) => {
        state.output += token;
        rerender();
      },
      onEvent: (event) => {
        state.events = [...state.events, event];
        if (event.type === "session.started") {
          state.sessionId = String(event.data.sessionId);
        }
        rerender();
      },
      requestApproval: context.approvalPrompter ?? createApprovalPrompter
    });

    state.status = "completed";
    state.output = result.assistantText || state.output;
    state.sessionId = result.session.sessionId;
    rerender();
  } catch (error) {
    state.status = "errored";
    state.error = (error as Error).message;
    rerender();
    process.exitCode = 1;
  } finally {
    setTimeout(() => {
      instance.unmount();
    }, 20);
    await instance.waitUntilExit();
  }
}

async function printModels(): Promise<void> {
  const registry = new ModelRegistry();
  for (const model of registry.list()) {
    console.log(
      `${model.id}\n  ${model.description}\n  context=${model.maxContextTokens} streaming=${model.capabilities.streaming} tools=${model.capabilities.toolCalls} thinking=${model.capabilities.thinking}`
    );
  }
}

async function printDoctor(cwd?: string): Promise<void> {
  const config = await loadKimicodeConfig(cwd);
  const sessions = await SessionManager.create(config);
  const skillPack = await loadStarterSkills();
  const record = {
    node: process.version,
    cwd: config.cwd,
    storageDir: config.storageDir,
    defaultModel: config.defaultModel,
    approvalMode: config.approvalMode,
    hasMoonshotApiKey: Boolean(process.env.MOONSHOT_API_KEY),
    enableOfficialTools: config.enableOfficialTools,
    officialToolFormulaCount: config.officialToolFormulas.length,
    knownSlashCommands: BUILTIN_SLASH_COMMANDS.map((command) => command.command),
    starterSkillCount: skillPack.skills.length,
    indexedSessions: sessions.listSessions(5).length
  };
  console.log(JSON.stringify(record, null, 2));
}

async function printConfig(cwd?: string): Promise<void> {
  const config = await loadKimicodeConfig(cwd);
  console.log(JSON.stringify(config, null, 2));
}

async function updateOfficialToolsConfig(
  options: {
    enable?: boolean;
    disable?: boolean;
    addFormula?: string;
    removeFormula?: string;
  },
  cwd?: string
): Promise<void> {
  const config = await loadKimicodeConfig(cwd);
  const fileConfig = await readProjectConfig(config.cwd);
  const currentFormulas = Array.isArray(fileConfig.officialToolFormulas)
    ? (fileConfig.officialToolFormulas as string[])
    : [...DEFAULT_OFFICIAL_TOOL_FORMULAS];
  const formulas = new Set(currentFormulas.map(normalizeOfficialToolFormula));

  if (options.addFormula) {
    formulas.add(normalizeOfficialToolFormula(options.addFormula));
  }

  if (options.removeFormula) {
    formulas.delete(normalizeOfficialToolFormula(options.removeFormula));
  }

  const next = {
    ...fileConfig,
    defaultModel: String(fileConfig.defaultModel ?? config.defaultModel),
    approvalMode: String(fileConfig.approvalMode ?? config.approvalMode),
    enableBuiltinTools: Boolean(fileConfig.enableBuiltinTools ?? config.enableBuiltinTools),
    enableOfficialTools:
      options.enable ? true : options.disable ? false : Boolean(fileConfig.enableOfficialTools ?? config.enableOfficialTools),
    officialToolFormulas: [...formulas],
    maxToolSteps: Number(fileConfig.maxToolSteps ?? config.maxToolSteps)
  };

  await writeProjectConfig(config.cwd, next);

  console.log(
    JSON.stringify(
      {
        enabled: next.enableOfficialTools,
        officialToolFormulas: next.officialToolFormulas
      },
      null,
      2
    )
  );
}

async function printTools(resolveOfficial: boolean, context: CliContext = {}): Promise<void> {
  const config = await loadKimicodeConfig(context.cwd);
  const manager = new ToolManager(config);
  let resolvedOfficial: Array<{ name: string; formulaUri?: string }> | null = null;

  if (resolveOfficial) {
    const apiKey = requireApiKey();
    const officialTools = await loadOfficialTools(config, context, apiKey);
    resolvedOfficial = officialTools.map((tool) => ({
      name: tool.name,
      formulaUri: tool.formulaUri
    }));
  }

  const toolSpecs = manager.listToolSpecs();
  const record = {
    localTools: toolSpecs.filter((tool) => tool.kind === "local").map((tool) => tool.name),
    builtinTools: toolSpecs.filter((tool) => tool.kind === "builtin").map((tool) => tool.name),
    officialTools: {
      enabled: config.enableOfficialTools,
      formulas: config.officialToolFormulas,
      resolved: resolvedOfficial
    }
  };

  console.log(JSON.stringify(record, null, 2));
}

async function printResume(sessionId?: string, cwd?: string): Promise<void> {
  const config = await loadKimicodeConfig(cwd);
  const sessions = await SessionManager.create(config);
  const resolvedSessionId = sessionId ?? sessions.latestSessionId();

  if (!resolvedSessionId) {
    console.log("No saved sessions found.");
    return;
  }

  const session = await sessions.loadSession(resolvedSessionId);
  if (!session) {
    console.log(`Session not found: ${resolvedSessionId}`);
    return;
  }

  console.log(
    JSON.stringify(
      {
        sessionId: session.sessionId,
        title: session.title,
        modelId: session.modelId,
        status: session.status,
        transcriptPath: session.transcriptPath,
        lastAssistantMessage: session.lastAssistantMessage,
        messageCount: session.messages.length
      },
      null,
      2
    )
  );
}

async function exportSession(sessionId?: string, outputPath?: string, cwd?: string): Promise<void> {
  const config = await loadKimicodeConfig(cwd);
  const sessions = await SessionManager.create(config);
  const resolvedSessionId = sessionId ?? sessions.latestSessionId();

  if (!resolvedSessionId) {
    console.log("No saved sessions found.");
    return;
  }

  const exported = await sessions.exportSession(resolvedSessionId);
  if (!exported) {
    console.log(`Session not found: ${resolvedSessionId}`);
    return;
  }

  const payload = JSON.stringify(exported, null, 2);
  if (!outputPath) {
    console.log(payload);
    return;
  }

  const absolutePath = resolve(config.cwd, outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${payload}\n`, "utf8");
  console.log(`Exported session ${resolvedSessionId} to ${absolutePath}`);
}

function createCli(context: CliContext = {}) {
  const cli = cac("kimicode");

  cli
    .command("run [...task]", "Run a prompt in Kimicode")
    .option("--model <model>", "Override the model for this run")
    .option("--session <sessionId>", "Continue an existing session")
    .action(async (task: string[], options: { model?: string; session?: string }) => {
      const prompt = task.join(" ").trim();
      if (!prompt) {
        throw new Error("kimicode run requires a task string.");
      }
      await executePrompt(
        prompt,
        {
          ...(options.model ? { modelIdOverride: options.model } : {}),
          ...(options.session ? { sessionId: options.session } : {})
        },
        context
      );
    });

  cli
    .command("resume [sessionId]", "Resume a previous session")
    .option("--continue <prompt>", "Continue the session with a new prompt")
    .option("--model <model>", "Override the model for the continued run")
    .action(async (sessionId: string | undefined, options: { continue?: string; model?: string }) => {
      if (options.continue) {
        await executePrompt(
          options.continue,
          {
            ...(options.model ? { modelIdOverride: options.model } : {}),
            ...(sessionId ? { sessionId } : {})
          },
          context
        );
        return;
      }

      await printResume(sessionId, context.cwd);
    });

  cli.command("models", "List available models").action(async () => {
    await printModels();
  });

  cli.command("doctor", "Inspect local configuration and environment").action(async () => {
    await printDoctor(context.cwd);
  });

  cli
    .command("tools", "Inspect local, builtin, and official tool surfaces")
    .option("--resolve-official", "Resolve configured official tools through the Moonshot API")
    .action(async (options: { resolveOfficial?: boolean }) => {
      await printTools(Boolean(options.resolveOfficial), context);
    });

  cli
    .command("config [action]", "Print effective configuration or initialize a project config")
    .option("--force", "Overwrite an existing config file")
    .option("--enable", "Enable the selected config surface")
    .option("--disable", "Disable the selected config surface")
    .option("--add-formula <formula>", "Add an official tool formula")
    .option("--remove-formula <formula>", "Remove an official tool formula")
    .action(
      async (
        action: string | undefined,
        options: {
          force?: boolean;
          enable?: boolean;
          disable?: boolean;
          addFormula?: string;
          removeFormula?: string;
        }
      ) => {
      if (!action) {
        await printConfig(context.cwd);
        return;
      }

      if (action !== "init") {
        if (action !== "official-tools") {
          throw new Error(`Unknown config action: ${action}`);
        }

        await updateOfficialToolsConfig(
          {
            enable: options.enable,
            disable: options.disable,
            addFormula: options.addFormula,
            removeFormula: options.removeFormula
          },
          context.cwd
        );
        return;
      }

      const configPath = await ensureConfigFile(Boolean(options.force), context.cwd);
      console.log(`Wrote ${configPath}`);
      }
    );

  cli
    .command("export [sessionId] [outputPath]", "Export a saved session transcript")
    .action(async (sessionId?: string, outputPath?: string) => {
      await exportSession(sessionId, outputPath, context.cwd);
    });

  cli.help();
  cli.version("0.1.0");

  return cli;
}

export async function runCli(argv = process.argv, context: CliContext = {}): Promise<void> {
  if (argv.length <= 2) {
    const prompt = await (context.interactivePrompt ?? runInteractivePrompt)();
    if (!prompt) {
      console.log("No task entered.");
      return;
    }
    await executePrompt(prompt, {}, context);
    return;
  }

  const cli = createCli(context);
  cli.parse(argv, { run: false });

  if (cli.matchedCommand) {
    await cli.runMatchedCommand();
  }
}
