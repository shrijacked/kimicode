# Security Policy

## Supported Versions

Kimicode is pre-1.0 software right now. Security fixes land on the latest `main` branch first, and releases cut from older commits should be treated as unsupported unless they are explicitly patched.

## Reporting A Vulnerability

Please do not open public GitHub issues for secrets exposure, sandbox escapes, unsafe tool execution paths, or provider-authentication leaks.

Instead:

1. Email the maintainer or repository owner directly with:
   - a short description of the issue
   - the impact
   - exact reproduction steps
   - whether the issue requires credential rotation
2. Include sanitized logs only. Do not send real API keys, tokens, cookies, or private repository contents.
3. If the issue involves a pasted or leaked credential, rotate it immediately before reporting.

## Response Expectations

- Initial acknowledgment target: within 7 days
- Triage target: within 14 days
- Fix timing depends on severity and reproducibility

## Secret Handling

- Never commit Moonshot, GitHub, or shell credentials into the repository
- Prefer repository or environment secrets over local plaintext files
- Treat keys pasted into chat, logs, screenshots, or issue bodies as compromised and rotate them

## Scope

This policy especially covers:

- provider authentication and request signing
- approval-gate bypasses
- unsafe shell or file-system access outside the configured workspace rules
- transcript or session leaks that expose sensitive content
