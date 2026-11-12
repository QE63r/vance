# CONTRIBUTING

Thanks for helping. Vance is a small, opinionated project: **the approval layer for
agents**, not another agent framework.

Before contributing, read:

- [`docs/positioning.md`](docs/positioning.md)
- [`docs/event-model.md`](docs/event-model.md)
- [`docs/adapter-contract.md`](docs/adapter-contract.md)

## What we want

- New adapters (Claude Code, Codex, other local agents)
- Policy rules and fail-closed edge cases
- Approval/console UX improvements
- Tests for event translation and rejection paths
- Documentation for adapter authors

## What we are not building here

- A new agent loop or model provider
- A consumer AI chat app
- A general-purpose remote desktop
- A cloud agent platform
- Silent auto-approval of dangerous actions

`labs/remote` is experimental; changes there should not leak into the core contract.

## Adapter contributions

An adapter must:

1. Translate native events into the four Vance events.
2. Return the human decision to the agent.
3. Fail closed on unknown or malformed input.
4. Include fixtures from real payloads and contract tests.
5. Not bypass `adapter-base`.

Open one adapter per PR. Keep the core event schema stable; breaking changes need a
versioned envelope.

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm typecheck
```

Windows is the primary verified environment. If you fix Linux/macOS behavior, include
the command you ran.

## Secrets and privacy

- Never commit API keys, tokens, real device IDs, or personal paths.
- Use `?demo=1` for screenshots, or sanitize them.
- Do not add a runtime dependency without a short justification in the PR.

## PR checklist

- [ ] Tests added/updated
- [ ] `pnpm test` green
- [ ] No secrets or personal data
- [ ] Docs updated
- [ ] Scope is the approval layer, not a side product
