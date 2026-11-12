/**
 * A deliberately small, path-sandboxed tool registry.
 *
 * The registry executes tools. It never decides whether a tool may run — that is
 * the host's policy/approval job. Built-ins stay inside `workspaceRoot` and cap
 * file sizes; there is intentionally no shell tool here.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "@vance/adapter-sdk";

export type ToolRisk = "read" | "write";

export type ToolErrorCode =
  | "unknown_tool"
  | "invalid_args"
  | "path_invalid"
  | "path_escape"
  | "not_found"
  | "not_file"
  | "not_directory"
  | "too_large"
  | "tool_failed";

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolAuditEvent {
  at: number;
  tool: string;
  ok: boolean;
  durationMs: number;
  code?: string;
}

export interface ToolContext {
  workspaceRoot: string;
}

export interface ToolSpec {
  risk: ToolRisk;
  definition: ToolDefinition;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  constructor(private readonly onAudit?: (event: ToolAuditEvent) => void) {}

  register(spec: ToolSpec): this {
    this.tools.set(spec.definition.function.name, spec);
    return this;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((spec) => spec.definition);
  }

  async execute(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const spec = this.tools.get(name);
    if (!spec) {
      const result = { ok: false, content: `Unknown tool: ${name}`, code: "unknown_tool" };
      this.audit(name, result, started);
      return result;
    }
    try {
      const result = await spec.execute(args, ctx);
      this.audit(name, result, started);
      return result;
    } catch (error) {
      const code = error instanceof ToolError ? error.code : "tool_failed";
      const result = {
        ok: false,
        content: error instanceof Error ? error.message : String(error),
        code,
      };
      this.audit(name, result, started);
      return result;
    }
  }

  private audit(tool: string, result: ToolResult, started: number): void {
    if (!this.onAudit) return;
    try {
      this.onAudit({
        at: Date.now(),
        tool,
        ok: result.ok,
        durationMs: Date.now() - started,
        ...(result.code ? { code: result.code } : {}),
      });
    } catch {
      // an audit sink must never break a tool call
    }
  }
}

function objectArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function inside(root: string, input: unknown, fallback = "."): { target: string; rel: string } {
  const raw = typeof input === "string" && input ? input : fallback;
  if (raw.includes("\0")) throw new ToolError("path_invalid", "path contains NUL");
  if (raw.length > 4096) throw new ToolError("path_invalid", "path is too long");
  if (isAbsolute(raw)) throw new ToolError("path_invalid", "absolute paths are not allowed");
  const base = resolve(root);
  const target = resolve(base, raw);
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ToolError("path_escape", "path escapes the workspace");
  return { target, rel: rel || "." };
}

function nearestExisting(path: string): string {
  let probe = path;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return probe;
}

/**
 * Lexical checks are not enough: a workspace symlink/junction can point outside.
 * Resolve the target (or its nearest existing parent) and compare real paths.
 */
function safeInside(root: string, input: unknown, fallback = "."): { target: string; rel: string } {
  const { target, rel } = inside(root, input, fallback);
  const baseReal = realpathSync(resolve(root));
  const check = existsSync(target) ? realpathSync(target) : realpathSync(nearestExisting(target));
  const realRel = relative(baseReal, check);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new ToolError("path_escape", "path escapes the workspace");
  }
  return { target, rel };
}

function displayPath(rel: string): string {
  return rel.split(/[\\/]/).join("/");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const MAX_BYTES = 200_000;

export function createBuiltinTools(onAudit?: (event: ToolAuditEvent) => void): ToolRegistry {
  return new ToolRegistry(onAudit)
    .register({
      risk: "read",
      definition: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a UTF-8 text file inside the workspace (max 200KB).",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
      async execute(args, ctx) {
        const values = objectArgs(args);
        if (typeof values.path !== "string" || !values.path) {
          return { ok: false, content: "path is required", code: "invalid_args" };
        }
        const { target, rel } = safeInside(ctx.workspaceRoot, values.path);
        if (!existsSync(target)) {
          return { ok: false, content: `Not found: ${displayPath(rel)}`, code: "not_found" };
        }
        const stat = statSync(target);
        if (!stat.isFile()) {
          return { ok: false, content: `Not a file: ${displayPath(rel)}`, code: "not_file" };
        }
        if (stat.size > MAX_BYTES) {
          return { ok: false, content: `File too large (max ${MAX_BYTES} bytes)`, code: "too_large" };
        }
        return { ok: true, content: readFileSync(target, "utf8") };
      },
    })
    .register({
      risk: "read",
      definition: {
        type: "function",
        function: {
          name: "list_dir",
          description: "List entries in a workspace directory (max 200 entries).",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
      async execute(args, ctx) {
        const { target, rel } = safeInside(ctx.workspaceRoot, objectArgs(args).path);
        if (!existsSync(target)) {
          return { ok: false, content: `Not found: ${displayPath(rel)}`, code: "not_found" };
        }
        const stat = statSync(target);
        if (!stat.isDirectory()) {
          return { ok: false, content: `Not a directory: ${displayPath(rel)}`, code: "not_directory" };
        }
        const rows = readdirSync(target, { withFileTypes: true })
          .slice(0, 200)
          .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`);
        return { ok: true, content: rows.join("\n") || "(empty)" };
      },
    })
    .register({
      risk: "write",
      definition: {
        type: "function",
        function: {
          name: "write_file",
          description: "Write a UTF-8 text file inside the workspace (max 200KB). Requires approval.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
      },
      async execute(args, ctx) {
        const values = objectArgs(args);
        if (typeof values.path !== "string" || !values.path) {
          return { ok: false, content: "path is required", code: "invalid_args" };
        }
        const content = text(values.content);
        if (Buffer.byteLength(content) > MAX_BYTES) {
          return { ok: false, content: `Content too large (max ${MAX_BYTES} bytes)`, code: "too_large" };
        }
        const { target, rel } = safeInside(ctx.workspaceRoot, values.path);
        try {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, content);
        } catch (error) {
          return {
            ok: false,
            content: error instanceof Error ? error.message : String(error),
            code: "tool_failed",
          };
        }
        return { ok: true, content: `Wrote ${Buffer.byteLength(content)} bytes to ${displayPath(rel)}` };
      },
    });
}
