export interface SlashCommandDefinition {
  command: string;
  description: string;
}

export const BUILTIN_SLASH_COMMANDS: SlashCommandDefinition[] = [
  { command: "/plan", description: "Create or refine an implementation plan." },
  { command: "/tdd", description: "Shift the session into test-first execution." },
  { command: "/review", description: "Review the current diff or task output." },
  { command: "/debug", description: "Investigate runtime failures and root causes." },
  { command: "/docs", description: "Update or generate documentation." },
  { command: "/model", description: "Switch models for the active session." },
  { command: "/status", description: "Show session status and model information." },
  { command: "/clear", description: "Clear the current conversation window." }
];

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  if (!input.startsWith("/")) {
    return null;
  }

  const [name, ...rest] = input.trim().split(/\s+/);
  return {
    name: name ?? input.trim(),
    args: rest.join(" ")
  };
}
