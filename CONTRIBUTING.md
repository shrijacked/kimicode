# Contributing

## Ground rules

- Keep the implementation clean-room. Do not copy code, prompt text, assets, or docs from third-party projects.
- Base behavior on public API docs, observed runtime behavior, and original implementation work.
- Keep public git history product-focused. Avoid mentioning private research inputs in commits, docs, or release notes.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Project standards

- Add tests with new behavior
- Keep provider rules explicit and documented
- Prefer structured transcript events over ad-hoc logging
- Preserve user-visible approval and safety boundaries
