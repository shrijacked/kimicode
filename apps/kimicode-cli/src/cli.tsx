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
  type ApprovalRequest,
  type TranscriptEvent
} from "@kimicode/core";
import { MoonshotProvider } from "@kimicode/provider-moonshot";
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

export interface CliContext {
  cwd?: string;
  interactivePrompt?: () => Promise<string>;
  approvalPrompter?: (request: ApprovalRequest) => Promise<boolean>;
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

const buildConfigTemplate = (): string =>
  JSON.stringify(
    {
      defaultModel: "kimi-k2.6",
      approvalMode: "workspace-write",
      enableBuiltinTools: false,
      maxToolSteps: 6
    },
    null,
    2
  );

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
  const provider = new MoonshotProvider({
    apiKey: requireApiKey()
  });
  const tools = new ToolManager(config);
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
    .command("config [action]", "Print effective configuration or initialize a project config")
    .option("--force", "Overwrite an existing config file")
    .action(async (action: string | undefined, options: { force?: boolean }) => {
      if (!action) {
        await printConfig(context.cwd);
        return;
      }

      if (action !== "init") {
        throw new Error(`Unknown config action: ${action}`);
      }

      const configPath = await ensureConfigFile(Boolean(options.force), context.cwd);
      console.log(`Wrote ${configPath}`);
    });

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
