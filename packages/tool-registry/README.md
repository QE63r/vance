# @vance/tool-registry

Small, path-sandboxed tools for the Vance examples and reference host.

```ts
import { createBuiltinTools } from "@vance/tool-registry";

const tools = createBuiltinTools((audit) => {
  console.log(audit.tool, audit.ok, audit.code, audit.durationMs);
});

await tools.execute("write_file", { path: "notes/today.md", content: "hi" }, {
  workspaceRoot: "/path/to/workspace",
});
```

## Built-ins

| tool | risk | notes |
| --- | --- | --- |
| `read_file` | read | UTF-8, max 200KB |
| `list_dir` | read | max 200 entries |
| `write_file` | write | max 200KB, host must approve first |

## Guarantees

- paths must stay inside `workspaceRoot`
- absolute paths, `..`, NUL, and oversized paths are rejected
- symlink/junction escapes are rejected using real paths
- no shell/network tool
- stable error codes: `unknown_tool`, `invalid_args`, `path_invalid`, `path_escape`,
  `not_found`, `not_file`, `not_directory`, `too_large`, `tool_failed`
- every call emits `{ at, tool, ok, durationMs, code? }` to an optional audit sink
- `register` / `unregister` / `names` support dynamic tool sets

The registry executes; it does not decide. Approval and policy stay in the host.
