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

## Tool calls

The OpenAI-compatible adapter supports tool calls. The host receives `onToolCall`,
turns the call into an `approval_request`, waits for the phone's decision, executes
the approved tool, and returns the result to the model.

The reference host uses `@vance/tool-registry`:

- `read_file` / `list_dir` (read, sandboxed)
- `write_file` (write, needs approval)
- all paths stay inside the workspace; 200KB cap; no shell tool

The host turns write calls into `approval_request`, waits for the phone's decision,
executes only after approval, and returns the result to the model. A general tool
registry, richer path policy, and shell tools are next. An adapter must never execute
a tool before the host approves it.
