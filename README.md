# Vance · 梵境

> **The local-first approval layer for AI agents.**  
> Agent 的本地审批层：任何 Agent 接进来，就得到确定性的审批门、决策记录和手机端人工接管。
>
> Vance is not an agent. It decides whether an agent may act.

Vance sits beside an agent and answers one question:

> **May this action run, and who approved it?**

It does not produce agents, run models, or host your data. It gives agent authors
and power users a deterministic, local-first control surface for the human-in-the-loop
part that every autonomous agent eventually needs.

---

## Why

Agents are moving from chat to execution. Once an agent can delete files, run shells,
call APIs, or touch production, the hard problem is no longer "can it plan?" — it is:

- **When must a human decide?**
- **What exactly did they approve?**
- **Can they stop it, and prove what happened?**

Most agents either ask nothing, ask too much, or build a one-off approval UI.
Vendor apps only control their own ecosystem. Vance is the neutral layer between them.

---

## What it gives you

- **A four-event contract** — `approval_request`, `question`, `tool_result`, `status_update`
- **A deterministic policy engine** — `DENY > APPROVAL > ALLOW`, fail-closed, one-time grants
- **Approval bound to the action** — the card shows the exact command/diff; approval cannot be replayed for something else
- **A local-first host** — runs on the user's machine; no cloud account required
- **A reference mobile console** — approvals, task view, artifacts, pause/stop
- **An adapter contract** — bring any agent; the control plane stays the same

---

## What it is not

- Not an agent framework
- Not a model provider
- Not a cloud agent platform
- Not a general-purpose remote desktop
- Not a consumer AI chat app
- Not a promise of "absolute safety"

Remote window takeover is an **experimental fallback** for GUI-only blockers
(login, captcha, file picker). It lives in [`labs/remote`](labs/remote/README.md)
and is not part of the core promise.

---

## Architecture

```
        any agent / ecosystem
   ┌───────────┬───────────┬───────────┐
   │  ACP      │  hook     │  HTTP     │
   └─────┬─────┴─────┬─────┴─────┬─────┘
         │           │           │
         ▼           ▼           ▼
   ┌───────────────────────────────────┐
   │        adapter contract           │
   │  normalize events, fail-closed    │
   └─────────────────┬─────────────────┘
                     ▼
   ┌───────────────────────────────────┐
   │            Vance Host             │
   │  policy engine · approval store   │
   │  local WS/HTTP · no model calls   │
   └─────────────────┬─────────────────┘
                     ▼
   ┌───────────────────────────────────┐
   │      reference mobile console     │
   │   approve · steer · inspect       │
   └───────────────────────────────────┘
```

The host is local by default. A blind-forward relay is planned, not required for v0.1.

---

## Repository layout

```
packages/
  core/              event schema + envelopes (zod)
  adapter-base/      fail-closed adapter base
  adapter-opencode/  ACP adapter (current reference)
  policy/            deterministic policy engine
  host/              local host: HTTP + WS + device pairing
  web/               reference mobile console (PWA)
  desktop/           reference WebView2 desktop shell (optional)
  relay/             planned blind-forward relay (empty)
docs/                event model, adapter contract, positioning
adr/                 architecture decisions
labs/remote/         experimental GUI takeover; not core
```

---

## Quickstart

Requirements: **Node.js 22+**, **pnpm 12+**.

```bash
pnpm install
pnpm test
```

UI-only demo (no agent, no host required):

```bash
pnpm dev
# open http://127.0.0.1:5173/pc?demo=1
```

Run a real local host:

```bash
node tools/host-demo.mjs /path/to/your/workspace
# the host prints a LAN/public URL and QR code
# open it on your phone; approve or reject from the console
```

The host may need an agent/API key for the adapter you use. The console's demo mode
does not.

---

## Integrating an agent

An adapter translates your agent's native events into four Vance events, then hands
approval decisions back to the agent. The policy engine decides whether an action is
silent, approval-gated, or denied.

- [`docs/event-model.md`](docs/event-model.md)
- [`docs/adapter-contract.md`](docs/adapter-contract.md)
- [`adr/0001-zod-as-schema-source.md`](adr/0001-zod-as-schema-source.md)

An adapter SDK is on the roadmap. Today, start from `packages/adapter-opencode`.

---

## Status

**v0.1 alpha** — the approval core and reference console are usable; the ecosystem is
not. One real adapter (opencode) is integrated. Relay, push notifications, packaging,
and third-party adapters are not done yet.

The roadmap is about **adding adapters**, not adding features:

1. Adapter SDK + adapter authoring guide
2. A second real adapter (Claude Code / Codex / OpenAI-compatible)
3. Same approval UX across both
4. Relay + push, then packaging

---

## Security

This is a local prototype, not a production security product.

- Host binds to the local machine/LAN by default
- Pairing uses a token; treat it like a password
- Policy is fail-closed: timeout and unknown cases deny
- No cloud dependency; no model calls from the host
- Do not expose the host to the public internet without understanding the risks

A threat model and a production hardening guide are planned.

---

## License

MIT. See [`LICENSE`](LICENSE).
