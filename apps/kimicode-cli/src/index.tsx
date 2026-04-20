#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { render } from "ink";
import React from "react";
import { cac } from "cac";
import { loadKimicodeConfig, ModelRegistry, SessionManager, BUILTIN_SLASH_COMMANDS, type ApprovalRequest, type TranscriptEvent } from "@kimicode/core";
import { MoonshotProvider } from "@kimicode/provider-moonshot";
import { ToolManager } from "@kimicode/tools";
import { loadStarterSkills } from "@kimicode/skills-starter";
import { App } from "./components/App.js";
import { KimicodeRuntime } from "@kimicode/core";

interface RuntimeState {
  sessionId: string;
  modelId: string;
  thinkingEnabled: boolean;
  output: string;
  events: TranscriptEvent[];
  status: string;
  error?: string;
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

async function executePrompt(prompt: string, modelIdOverride?: string): Promise<void> {
  const config = await loadKimicodeConfig();
  const registry = new ModelRegistry();
  const model = registry.resolve(modelIdOverride ?? config.defaultModel);
  const sessions = await SessionManager.create(config);
  const provider = new MoonshotProvider({
    apiKey: requireApiKey()
  });
  const tools = new ToolManager(config);
  await loadStarterSkills();

  const runtime = new KimicodeRuntime(config, registry, provider, sessions, tools);

  const state: RuntimeState = {
    sessionId: "pending",
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

    const result = await runtime.runTask(
      {
        prompt,
        modelId: model.id,
        stream: true
      },
      {
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
        requestApproval: createApprovalPrompter
      }
    );

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

async function printDoctor(): Promise<void> {
  const config = await loadKimicodeConfig();
  const sessions = await SessionManager.create(config);
  const record = {
    node: process.version,
    cwd: config.cwd,
    storageDir: config.storageDir,
    defaultModel: config.defaultModel,
    approvalMode: config.approvalMode,
    hasMoonshotApiKey: Boolean(process.env.MOONSHOT_API_KEY),
    knownSlashCommands: BUILTIN_SLASH_COMMANDS.map((command) => command.command),
    indexedSessions: sessions.listSessions(5).length
  };
  console.log(JSON.stringify(record, null, 2));
}

async function printConfig(): Promise<void> {
  const config = await loadKimicodeConfig();
  console.log(JSON.stringify(config, null, 2));
}

async function printResume(sessionId?: string): Promise<void> {
  const config = await loadKimicodeConfig();
  const sessions = await SessionManager.create(config);
  const resolvedSessionId = sessionId ?? sessions.listSessions(1)[0]?.sessionId;

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

const cli = cac("kimicode");

cli
  .command("run [...task]", "Run a prompt in Kimicode")
  .option("--model <model>", "Override the model for this run")
  .action(async (task: string[], options: { model?: string }) => {
    const prompt = task.join(" ").trim();
    if (!prompt) {
      throw new Error("kimicode run requires a task string.");
    }
    await executePrompt(prompt, options.model);
  });

cli.command("resume [sessionId]", "Resume a previous session").action(async (sessionId?: string) => {
  await printResume(sessionId);
});

cli.command("models", "List available models").action(async () => {
  await printModels();
});

cli.command("doctor", "Inspect local configuration and environment").action(async () => {
  await printDoctor();
});

cli.command("config", "Print effective configuration").action(async () => {
  await printConfig();
});

cli.help();
cli.version("0.1.0");

cli.parse(process.argv);

if (process.argv.length <= 2) {
  const prompt = await runInteractivePrompt();
  if (!prompt) {
    console.log("No task entered.");
    process.exit(0);
  }
  await executePrompt(prompt);
}
