import type { ApprovalMode, ModelManifest, SkillDocument, SkillPackManifest } from "@kimicode/core";
import { parseSlashCommand } from "@kimicode/core";
import { findSkillByCommand } from "@kimicode/skills-starter";

export interface PromptRouteContext {
  cwd: string;
  storageDir: string;
  approvalMode: ApprovalMode;
  defaultModelId: string;
  sessionCount: number;
  models: ModelManifest[];
  skillPack: SkillPackManifest;
}

export type PromptRoute =
  | {
      kind: "local";
      output: string;
    }
  | {
      kind: "model";
      prompt: string;
      systemPrompt?: string;
      modelId?: string;
      title?: string;
    };

const WORKFLOW_COMMANDS = new Set(["/plan", "/tdd", "/review", "/debug", "/docs"]);

const buildWorkflowPrompt = (skill: SkillDocument, args: string): string => {
  const sections = [
    "You are running a named Kimicode workflow.",
    `Workflow: ${skill.metadata.name}`,
    skill.body
  ];

  if (args.trim()) {
    sections.push(`User focus: ${args.trim()}`);
  }

  sections.push("Keep the response aligned with the workflow and grounded in the current workspace.");
  return sections.join("\n\n");
};

const formatStatus = (context: PromptRouteContext): string =>
  JSON.stringify(
    {
      cwd: context.cwd,
      storageDir: context.storageDir,
      approvalMode: context.approvalMode,
      defaultModelId: context.defaultModelId,
      sessionCount: context.sessionCount,
      models: context.models.map((model) => ({
        id: model.id,
        thinking: model.capabilities.thinking,
        tools: model.capabilities.toolCalls,
        multimodal: model.capabilities.multimodal
      })),
      skills: context.skillPack.skills.map((skill) => ({
        command: skill.metadata.command,
        name: skill.metadata.name
      }))
    },
    null,
    2
  );

const formatModelList = (context: PromptRouteContext): string =>
  context.models
    .map((model) => {
      const marker = model.id === context.defaultModelId ? " (default)" : "";
      return `${model.id}${marker}\n  ${model.description}`;
    })
    .join("\n");

export function routePromptInput(input: string, context: PromptRouteContext): PromptRoute {
  const parsed = parseSlashCommand(input);

  if (!parsed) {
    return {
      kind: "model",
      prompt: input
    };
  }

  if (parsed.name === "/status") {
    return {
      kind: "local",
      output: formatStatus(context)
    };
  }

  if (parsed.name === "/clear") {
    return {
      kind: "local",
      output: "Kimicode is running one task per invocation right now, so there is no in-memory chat buffer to clear. Start the next prompt or resume a saved session."
    };
  }

  if (parsed.name === "/model") {
    const requested = parsed.args.trim();
    if (!requested) {
      return {
        kind: "local",
        output: formatModelList(context)
      };
    }

    const model = context.models.find((candidate) => candidate.id === requested);
    if (!model) {
      return {
        kind: "local",
        output: `Unknown model: ${requested}\n\n${formatModelList(context)}`
      };
    }

    return {
      kind: "local",
      output: JSON.stringify(model, null, 2)
    };
  }

  if (WORKFLOW_COMMANDS.has(parsed.name)) {
    const skill = findSkillByCommand(context.skillPack, parsed.name);

    if (!skill) {
      return {
        kind: "local",
        output: `No workflow registered for ${parsed.name}.`
      };
    }

    return {
      kind: "model",
      prompt: parsed.args.trim() || `Inspect the current workspace and apply the ${skill.metadata.name} workflow to propose the strongest next step.`,
      systemPrompt: buildWorkflowPrompt(skill, parsed.args),
      title: `${skill.metadata.name} workflow`
    };
  }

  return {
    kind: "local",
    output: `Unknown slash command: ${parsed.name}`
  };
}
