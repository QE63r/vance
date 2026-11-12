import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBuiltinTools } from "../src/index.js";

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
});
