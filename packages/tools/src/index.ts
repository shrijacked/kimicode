import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  ApprovalRequest,
  KimicodeConfig,
  RuntimeHooks,
  SessionSnapshot,
  ToolSpec
} from "@kimicode/core";

const exec = promisify(execCallback);
const READ_ONLY_SHELL_PREFIXES = [/^git status\b/, /^git diff\b/, /^git log\b/, /^ls\b/, /^pwd\b/, /^rg\b/, /^grep\b/, /^cat\b/];
const DANGEROUS_SHELL_PATTERNS = [/rm\s+-rf/, /git reset --hard/, /shutdown\b/, /reboot\b/, /sudo\b/];

const builtinTool: ToolSpec = {
  name: "builtin_web_search",
  description: "Optional Kimi built-in web search tool.",
  kind: "builtin",
  builtinName: "$web_search",
  inputSchema: {
    type: "object",
    properties: {}
  }
};

const readFileTool: ToolSpec = {
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
    },
    required: ["path"]
  }
};

const writePatchTool: ToolSpec = {
  name: "write_patch",
  description: "Apply one or more replace operations to a text file.",
  kind: "local",
  requiresWriteAccess: true,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            search: { type: "string" },
            replace: { type: "string" }
          },
          required: ["search", "replace"]
        }
      }
    },
    required: ["path", "operations"]
  }
};

const shellTool: ToolSpec = {
  name: "shell",
  description: "Execute a shell command in the workspace.",
  kind: "local",
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" }
    },
    required: ["command"]
  }
};

const grepTool: ToolSpec = {
  name: "grep",
  description: "Search for text across files in the workspace.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" }
    },
    required: ["pattern"]
  }
};

const globTool: ToolSpec = {
  name: "glob",
  description: "List files that match a simple glob pattern.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" }
    },
    required: ["pattern"]
  }
};

const fetchTool: ToolSpec = {
  name: "fetch_url",
  description: "Fetch a URL and return its text content.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" }
    },
    required: ["url"]
  }
};

const gitStatusTool: ToolSpec = {
  name: "git_status",
  description: "Show repository status.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {}
  }
};

const gitDiffTool: ToolSpec = {
  name: "git_diff",
  description: "Show a git diff for the current workspace.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string" }
    }
  }
};

const gitLogTool: ToolSpec = {
  name: "git_log",
  description: "Show a short git log.",
  kind: "local",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number" }
    }
  }
};

const writePlanTool: ToolSpec = {
  name: "write_plan",
  description: "Write a planning note into the workspace.",
  kind: "local",
  requiresWriteAccess: true,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }
    },
    required: ["path", "content"]
  }
};

const toolSpecs = [readFileTool, writePatchTool, shellTool, grepTool, globTool, fetchTool, gitStatusTool, gitDiffTool, gitLogTool, writePlanTool];

const readFileSchema = z.object({
  path: z.string()
});

const writePatchSchema = z.object({
  path: z.string(),
  operations: z.array(
    z.object({
      search: z.string(),
      replace: z.string()
    })
  )
});

const shellSchema = z.object({
  command: z.string()
});

const patternSchema = z.object({
  pattern: z.string()
});

const fetchSchema = z.object({
  url: z.string().url()
});

const gitDiffSchema = z.object({
  target: z.string().optional()
});

const gitLogSchema = z.object({
  count: z.number().int().positive().optional()
});

const writePlanSchema = z.object({
  path: z.string(),
  content: z.string()
});

const truncate = (value: string, max = 4_000): string => (value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`);

const resolveWorkspacePath = (cwd: string, inputPath: string): string => resolve(cwd, inputPath);

const ensureWithinWorkspace = (cwd: string, inputPath: string): string => {
  const absolute = resolveWorkspacePath(cwd, inputPath);
  const rel = relative(cwd, absolute);
  if (rel.startsWith("..")) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return absolute;
};

const matchGlob = (pattern: string, path: string): boolean => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(path);
};

const walk = async (cwd: string, current = ""): Promise<string[]> => {
  const root = join(cwd, current);
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".kimicode") {
      continue;
    }

    const next = join(current, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(cwd, next)));
    } else {
      paths.push(next);
    }
  }

  return paths;
};

const isReadOnlyShell = (command: string): boolean => READ_ONLY_SHELL_PREFIXES.some((pattern) => pattern.test(command));
const isDangerousShell = (command: string): boolean => DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(command));

interface ToolManagerOptions {
  officialTools?: ToolSpec[];
  executeOfficialTool?: (spec: ToolSpec, rawArguments: string) => Promise<string>;
}

export class ToolManager {
  private readonly officialTools: ToolSpec[];

  public constructor(
    private readonly config: KimicodeConfig,
    private readonly options: ToolManagerOptions = {}
  ) {
    this.officialTools = options.officialTools ?? [];
  }

  public listToolSpecs(): ToolSpec[] {
    const builtin = this.config.enableBuiltinTools ? [builtinTool] : [];
    const official = this.config.enableOfficialTools ? this.officialTools : [];

    return [...toolSpecs, ...builtin, ...official];
  }

  public async executeToolCall(
    callName: string,
    rawArguments: string,
    hooks: RuntimeHooks,
    session: SessionSnapshot
  ): Promise<{ content: string; approved: boolean }> {
    const input = rawArguments.length > 0 ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
    const spec = this.listToolSpecs().find((tool) => tool.name === callName);

    if (!spec) {
      throw new Error(`Unknown tool: ${callName}`);
    }

    if (spec.kind === "builtin") {
      return {
        content: JSON.stringify({ status: "builtin-passthrough", tool: spec.builtinName }),
        approved: true
      };
    }

    await this.enforcePermissions(spec, input, hooks, session);

    if (spec.kind === "official") {
      if (!this.options.executeOfficialTool) {
        throw new Error(`Official tool execution is not configured for ${spec.name}.`);
      }

      return {
        content: await this.options.executeOfficialTool(spec, rawArguments),
        approved: true
      };
    }

    switch (callName) {
      case "read_file":
        return {
          content: await this.readFile(readFileSchema.parse(input).path),
          approved: true
        };
      case "write_patch":
        return {
          content: await this.writePatch(writePatchSchema.parse(input)),
          approved: true
        };
      case "shell":
        return this.runShell(shellSchema.parse(input).command);
      case "grep":
        return {
          content: await this.grep(patternSchema.parse(input).pattern),
          approved: true
        };
      case "glob":
        return {
          content: await this.glob(patternSchema.parse(input).pattern),
          approved: true
        };
      case "fetch_url":
        return {
          content: await this.fetchUrl(fetchSchema.parse(input).url),
          approved: true
        };
      case "git_status":
        return {
          content: await this.runGit("git status --short --branch"),
          approved: true
        };
      case "git_diff":
        return {
          content: await this.runGit(`git diff ${gitDiffSchema.parse(input).target ?? ""}`.trim()),
          approved: true
        };
      case "git_log":
        return {
          content: await this.runGit(`git log --oneline -n ${gitLogSchema.parse(input).count ?? 10}`),
          approved: true
        };
      case "write_plan":
        return {
          content: await this.writePlan(writePlanSchema.parse(input)),
          approved: true
        };
      default:
        throw new Error(`Unhandled tool: ${callName}`);
    }
  }

  private async enforcePermissions(
    spec: ToolSpec,
    input: Record<string, unknown>,
    hooks: RuntimeHooks,
    session: SessionSnapshot
  ): Promise<void> {
    if (this.config.approvalMode === "full-auto") {
      return;
    }

    const requestApproval = async (reason: string): Promise<void> => {
      const request: ApprovalRequest = {
        sessionId: session.sessionId,
        toolName: spec.name,
        reason,
        input
      };
      hooks.onEvent?.({
        id: crypto.randomUUID(),
        sessionId: session.sessionId,
        timestamp: new Date().toISOString(),
        type: "approval.requested",
        data: {
          toolName: request.toolName,
          reason: request.reason,
          input: request.input
        }
      });

      const approved = await hooks.requestApproval?.(request);
      if (!approved) {
        throw new Error(`Approval denied for tool ${spec.name}`);
      }
    };

    if (this.config.approvalMode === "read-only" && spec.requiresWriteAccess) {
      throw new Error(`Tool ${spec.name} requires write access but approval mode is read-only.`);
    }

    if (spec.name === "shell") {
      const command = String(input.command ?? "");
      if (this.config.approvalMode === "read-only" && !isReadOnlyShell(command)) {
        throw new Error(`Shell command is not read-only: ${command}`);
      }

      if (isDangerousShell(command)) {
        await requestApproval(`Shell command looks destructive: ${command}`);
      } else if (spec.requiresConfirmation) {
        await requestApproval(`Shell command requires approval: ${command}`);
      }
    }

    if (this.config.approvalMode === "workspace-write" && spec.destructive) {
      await requestApproval(`Tool ${spec.name} is marked destructive.`);
    }
  }

  private async readFile(inputPath: string): Promise<string> {
    const absolute = ensureWithinWorkspace(this.config.cwd, inputPath);
    return readFile(absolute, "utf8");
  }

  private async writePatch(input: z.infer<typeof writePatchSchema>): Promise<string> {
    const absolute = ensureWithinWorkspace(this.config.cwd, input.path);
    let current = await readFile(absolute, "utf8");
    const changes: string[] = [];

    for (const operation of input.operations) {
      if (!current.includes(operation.search)) {
        throw new Error(`Patch search string not found in ${input.path}`);
      }

      current = current.replace(operation.search, operation.replace);
      changes.push(`Replaced "${operation.search}"`);
    }

    await writeFile(absolute, current, "utf8");

    return JSON.stringify({
      path: input.path,
      changes
    });
  }

  private async runShell(command: string): Promise<{ content: string; approved: boolean }> {
    const { stdout, stderr } = await exec(command, {
      cwd: this.config.cwd,
      shell: "/bin/zsh",
      timeout: 20_000,
      maxBuffer: 1024 * 1024
    });

    return {
      approved: true,
      content: JSON.stringify({
        command,
        stdout: truncate(stdout),
        stderr: truncate(stderr)
      })
    };
  }

  private async grep(pattern: string): Promise<string> {
    const files = await walk(this.config.cwd);
    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (const file of files) {
      const absolute = join(this.config.cwd, file);
      const raw = await readFile(absolute, "utf8").catch(() => "");
      if (!raw) {
        continue;
      }

      const lines = raw.split("\n");
      lines.forEach((line, index) => {
        if (line.includes(pattern)) {
          matches.push({
            path: file,
            line: index + 1,
            text: line.trim()
          });
        }
      });
    }

    return JSON.stringify(matches.slice(0, 200));
  }

  private async glob(pattern: string): Promise<string> {
    const files = await walk(this.config.cwd);
    return JSON.stringify(files.filter((file) => matchGlob(pattern, file)));
  }

  private async fetchUrl(url: string): Promise<string> {
    const response = await fetch(url);
    const text = await response.text();
    return truncate(text, 8_000);
  }

  private async runGit(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await exec(command, {
        cwd: this.config.cwd,
        shell: "/bin/zsh"
      });
      return JSON.stringify({
        command,
        stdout: truncate(stdout),
        stderr: truncate(stderr)
      });
    } catch (error) {
      return JSON.stringify({
        command,
        error: (error as Error).message
      });
    }
  }

  private async writePlan(input: z.infer<typeof writePlanSchema>): Promise<string> {
    const absolute = ensureWithinWorkspace(this.config.cwd, input.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, input.content, "utf8");
    return JSON.stringify({ path: input.path, written: true });
  }
}
