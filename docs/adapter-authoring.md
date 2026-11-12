# Writing an adapter

An adapter is the only place that knows an agent's native protocol. It must not
contain policy decisions: those belong to `@vance/policy` / `adapter-base`.

## Minimum interface

```ts
import type { AgentAdapter, AgentAdapterHandlers } from "@vance/adapter-sdk";

class MyAdapter implements AgentAdapter {
  readonly id = "my-agent";
  constructor(private handlers: AgentAdapterHandlers) {}

  async start() { /* spawn/connect; throw on failure */ }
  async prompt(text: string) { /* stream deltas via handlers.onChat */ }
  cancel() { /* abort in-flight turn */ }
  async close() { /* kill/cleanup */ }
}
```

- `onChat(messageId, text, delta)` streams assistant text.
- `onStatus("running" | "done" | "error", detail?)` reports turn state.
- `onError(message)` reports protocol/transport errors; `prompt()` must reject too.
- One turn at a time; a second `prompt()` while running must reject.

## Example

See `packages/adapter-openai-compatible` (DeepSeek/Ark-compatible chat) and
`examples/openai-compatible-host.mjs`.

## Rules

1. **Fail closed**: unknown/malformed native input must not become an action.
2. **No model-generated approval text**: show the agent's exact command/diff.
3. **No secrets in events/logs**: redact tokens, keys, cookies.
4. **Fixtures + contract tests**: record real payloads; no invented protocol.
5. **Adapter isolation**: one ecosystem per package; do not import another adapter.

## Approval path

Chat adapters (like the OpenAI-compatible one) have no tool calls and therefore
no approval requests. Tool-calling adapters must translate each tool proposal to
an `ApprovalRequest` and wait for the host's decision before executing. A
reference tool-calling adapter is on the roadmap.
