# Changelog

## 0.1.0 — 2026-11-13

First public alpha of Vance as a local-first approval layer for AI agents.

### Added

- Four-event contract: `approval_request`, `question`, `tool_result`, `status_update`
- Deterministic policy engine: `DENY > APPROVAL > ALLOW`, fail-closed, one-time grants
- Local Host with device pairing, trusted devices, history, pending approvals, artifacts
- Reference mobile console (PWA) and WebView2 desktop shell
- `@vance/adapter-sdk`: `start / prompt / cancel / close` plus tool-call hook
- ACP adapter for opencode (integrated reference adapter)
- OpenAI-compatible adapter for DeepSeek / Volcengine Ark (SSE streaming)
- Host/console agent advertising and `agent/select`
- `@vance/tool-registry`: sandboxed `read_file`, `list_dir`, `write_file`
  - workspace-only paths, symlink/junction checks, size caps, stable error codes, audit events
- Approval-gated external tool calls (`write_file` needs a phone decision; result returns to the model)
- `examples/toy-agent`: minimal agent loop, approval callback, trace
- 10 deterministic toy-agent fixtures + `eval` report
- Sanitized mobile screenshots in README
- MIT license, contributing guide, Windows CI workflow

### Security

- Agent adapters must fail closed; unknown/malformed events become `DENY`
- Raw bytes are approval-bound via `raw_digest`
- No shell/network tool in the reference registry
- No tokens, personal paths, or real device IDs in committed screenshots/docs

### Known limitations

- Windows-first; Linux/macOS Host is not CI-verified yet
- External tool support is reference-only (`read_file`, `list_dir`, `write_file`)
- No shell tool, relay, push notifications, installer, or account system yet
- PWA installation on Android still uses a home-screen shortcut
- GitHub Actions has not been observed green for this exact release in the local environment

### Verification

Local baseline at release preparation:

- `pnpm test` — 200 passing
- `pnpm build` — 12 tasks
- `pnpm typecheck` — passing
- `pnpm --filter @vance/toy-agent eval` — 10/10 fixtures
