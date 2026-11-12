import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, ScriptedModel, ToyAgent } from "../src/index.js";

describe("toy agent fixtures", () => {
  for (const fixture of FIXTURES) {
    it(fixture.id, async () => {
      const root = mkdtempSync(join(tmpdir(), `vance-toy-${fixture.id}-`));
      try {
        for (const [path, content] of Object.entries(fixture.files ?? {})) {
          writeFileSync(join(root, path), content);
        }
        const agent = new ToyAgent({
          model: new ScriptedModel(fixture.actions),
          workspaceRoot: root,
          approve: () => fixture.approve ?? false,
        });

        const result = await agent.run(fixture.prompt);

        expect(result.final).toBe(fixture.expected.final);
        expect(result.approvals).toBe(fixture.expected.approvals);
        expect(result.trace.map((entry) => entry.name)).toEqual(fixture.expected.tools);
        if (fixture.expected.errorIncludes) {
          expect(result.trace.at(-1)?.result.ok).toBe(false);
          expect(result.trace.at(-1)?.result.content).toContain(fixture.expected.errorIncludes);
        }
        for (const [path, content] of Object.entries(fixture.expected.files ?? {})) {
          expect(readFileSync(join(root, path), "utf8")).toBe(content);
        }
        if (fixture.id === "write-denied" || fixture.id === "escape-rejected") {
          expect(existsSync(join(root, "out.txt"))).toBe(false);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("stops after maxSteps", async () => {
    const root = mkdtempSync(join(tmpdir(), "vance-toy-max-"));
    try {
      const agent = new ToyAgent({
        model: new ScriptedModel([
          { type: "tool", name: "list_dir", arguments: {} },
          { type: "tool", name: "list_dir", arguments: {} },
        ]),
        workspaceRoot: root,
        maxSteps: 1,
      });
      await expect(agent.run("loop")).rejects.toThrow("exceeded 1 steps");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
