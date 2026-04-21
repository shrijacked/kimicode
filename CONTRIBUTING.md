# Contributing

## Ground rules

- Keep the implementation clean-room. Do not copy code, prompt text, assets, or docs from third-party projects.
- Base behavior on public API docs, observed runtime behavior, and original implementation work.
- Keep public git history product-focused. Avoid mentioning private research inputs in commits, docs, or release notes.

## Development

```bash
pnpm install
pnpm verify
```

`pnpm test:live` is opt-in and requires `MOONSHOT_API_KEY`.

## GitHub Actions

- `CI` runs on pushes and pull requests
- `Live Smoke` is manual and requires the repository `MOONSHOT_API_KEY` secret
- run `pnpm release:check` locally before cutting a release or changing publishable package metadata

## Community Files

- `SECURITY.md` covers vulnerability and secret-reporting expectations
- `CODE_OF_CONDUCT.md` sets contributor behavior expectations
- `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md` keep public reports and PRs structured

## Project standards

- Add tests with new behavior
- Keep provider rules explicit and documented
- Prefer structured transcript events over ad-hoc logging
- Preserve user-visible approval and safety boundaries
