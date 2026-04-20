# Kimicode

Kimicode is a Kimi-first coding agent CLI for Moonshot models.

It is built as a clean-room, public OSS project around Moonshot's documented API surface. The first release centers on a strong terminal workflow: session persistence, local coding tools, approval gates, model-aware provider rules, and a small starter skill pack that is authored directly for Kimicode.

## Why Kimicode

- Default model: `kimi-k2.6`
- Future Kimi models land through a model registry, not core rewrites
- Local coding tools are first-class, with approval modes for read-only, workspace-write, and full-auto
- Session transcripts are append-only JSONL for replay and debugging
- Session metadata is indexed in SQLite for fast resume and search

## Architecture

```mermaid
flowchart LR
  U["Developer"] --> CLI["CLI + TUI Surface"]
  CLI --> ORCH["Session Orchestrator"]
  ORCH --> REG["Model Registry"]
  ORCH --> TOOL["Tool Runtime + Permission Gates"]
  ORCH --> SKILL["Skill + Slash Command Engine"]
  ORCH --> STORE["Transcript Store + Session Index"]
  REG --> MS["Moonshot Provider Adapter"]
  MS --> API["Moonshot/Kimi API"]
  TOOL --> LOCAL["Local Coding Tools"]
  TOOL --> BUILTIN["Optional Kimi Built-in Tools"]
```

## Workspace layout

- `apps/kimicode-cli`
- `packages/core`
- `packages/provider-moonshot`
- `packages/tools`
- `packages/skills-starter`
- `packages/testkit`

## Install

```bash
pnpm install
pnpm build
pnpm test
```

## Commands

- `kimicode`
- `kimicode run "fix the failing build"`
- `kimicode resume`
- `kimicode models`
- `kimicode doctor`
- `kimicode config`

## Configuration

Project config lives in `kimicode.config.json`.

Environment variables:

- `MOONSHOT_API_KEY`
- `KIMICODE_MODEL`
- `KIMICODE_APPROVAL_MODE`
- `KIMICODE_SESSION_ID`

See [docs/architecture.md](./docs/architecture.md) for the runtime breakdown.
