import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBuiltinTools, type ToolAuditEvent } from "../src/index.js";

describe("builtin tool registry", () => {
  it("writes, reads and lists inside the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-tools-"));
    try {
      const tools = createBuiltinTools();
      const ctx = { workspaceRoot: root };

      const write = await tools.execute("write_file", { path: "notes/a.txt", content: "hello" }, ctx);
      expect(write).toEqual({ ok: true, content: "Wrote 5 bytes to notes/a.txt" });

      const read = await tools.execute("read_file", { path: "notes/a.txt" }, ctx);
      expect(read).toEqual({ ok: true, content: "hello" });

      const list = await tools.execute("list_dir", { path: "." }, ctx);
      expect(list.ok).toBe(true);
      expect(list.content).toContain("d notes");

      expect(tools.definitions().map((d) => d.function.name).sort()).toEqual([
        "list_dir",
        "read_file",
        "write_file",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects path escapes and absolute paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-tools-"));
    try {
      const tools = createBuiltinTools();
      const ctx = { workspaceRoot: root };
      expect((await tools.execute("read_file", { path: "../secret.txt" }, ctx)).ok).toBe(false);
      expect((await tools.execute("read_file", { path: "C:\\Windows\\win.ini" }, ctx)).ok).toBe(false);
      expect((await tools.execute("write_file", { path: "../x", content: "x" }, ctx)).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized reads and reports unknown tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-tools-"));
    try {
      writeFileSync(join(root, "large.txt"), "x".repeat(200_001));
      const tools = createBuiltinTools();
      const ctx = { workspaceRoot: root };
      expect((await tools.execute("read_file", { path: "large.txt" }, ctx)).ok).toBe(false);
      expect((await tools.execute("nope", {}, ctx)).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink/junction escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-tools-"));
    const outside = mkdtempSync(join(tmpdir(), "vance-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      try {
        symlinkSync(outside, join(root, "link"), "junction");
      } catch {
        return; // symlink creation may require privileges on some runners
      }
      const tools = createBuiltinTools();
      const ctx = { workspaceRoot: root };
      const read = await tools.execute("read_file", { path: "link/secret.txt" }, ctx);
      expect(read.ok).toBe(false);
      expect(read.content).toContain("escapes the workspace");
      const write = await tools.execute("write_file", { path: "link/x.txt", content: "x" }, ctx);
      expect(write.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns stable codes and audits every call", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-tools-"));
    try {
      const audits: ToolAuditEvent[] = [];
      const tools = createBuiltinTools((event) => audits.push(event));
      const ctx = { workspaceRoot: root };

      expect((await tools.execute("read_file", { path: "../x" }, ctx)).code).toBe("path_escape");
      expect((await tools.execute("read_file", { path: "missing.txt" }, ctx)).code).toBe("not_found");
      expect((await tools.execute("nope", {}, ctx)).code).toBe("unknown_tool");
      expect((await tools.execute("write_file", { path: "a.txt", content: "ok" }, ctx)).ok).toBe(true);

      expect(audits).toHaveLength(4);
      expect(audits.map((event) => event.ok)).toEqual([false, false, false, true]);
      expect(audits[0]?.code).toBe("path_escape");
      expect(tools.names()).toContain("write_file");
      expect(tools.unregister("write_file")).toBe(true);
      expect(tools.get("write_file")).toBeUndefined();
      expect(tools.names()).not.toContain("write_file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
