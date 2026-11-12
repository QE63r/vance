# Toy agent

A deliberately small agent loop used as a reference and as an eval harness.

It owns:

- one model turn at a time
- tool dispatch through `@vance/tool-registry`
- an approval callback for write tools
- a trace of every tool call, risk, decision, and result

It does **not** call a real model by default. `ScriptedModel` drives deterministic
fixtures, so the eval suite needs no API key or network.

## Run

```bash
pnpm --filter @vance/toy-agent test
pnpm --filter @vance/toy-agent eval
```

`eval` prints one line per fixture and a `10/10 fixtures passed` summary.

## Fixtures

`src/fixtures.ts` contains ten tasks:

| fixture | behavior |
| --- | --- |
| `list-workspace` | read-only listing |
| `read-file` | read a file |
| `write-approved` | approved write |
| `write-denied` | rejected write leaves no file |
| `escape-rejected` | `..` path rejected |
| `unknown-tool` | unknown tool reported, loop continues |
| `read-then-write` | two tools, one approval |
| `final-only` | no tool call |
| `overwrite` | approved overwrite |
| `missing-read` | missing file reported |

The suite also checks that `maxSteps` stops a runaway loop.

## What this proves

This is the agent-native half of the portfolio: a real loop, tool schema dispatch,
approval decisions, deterministic evals, and no hidden model/network dependency.
It is not intended to be a production agent runtime.
