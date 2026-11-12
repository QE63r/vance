/**
 * Run the deterministic fixtures and print a small eval report.
 * Usage: pnpm --filter @vance/toy-agent eval
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, ScriptedModel, ToyAgent } from "./index.js";

let passed = 0;
const failures: string[] = [];

for (const fixture of FIXTURES) {
  const root = mkdtempSync(join(tmpdir(), `vance-eval-${fixture.id}-`));
  try {
    for (const [path, content] of Object.entries(fixture.files ?? {})) {
      writeFileSync(join(root, path), content);
    }
    const result = await new ToyAgent({
      model: new ScriptedModel(fixture.actions),
      workspaceRoot: root,
      approve: () => fixture.approve ?? false,
    }).run(fixture.prompt);

    const problems: string[] = [];
    if (result.final !== fixture.expected.final) {
      problems.push(`final ${JSON.stringify(result.final)} != ${JSON.stringify(fixture.expected.final)}`);
    }
    if (result.approvals !== fixture.expected.approvals) {
      problems.push(`approvals ${result.approvals} != ${fixture.expected.approvals}`);
    }
    const tools = result.trace.map((entry) => entry.name);
    if (JSON.stringify(tools) !== JSON.stringify(fixture.expected.tools)) {
      problems.push(`tools ${JSON.stringify(tools)}`);
    }
    if (fixture.expected.errorIncludes) {
      const last = result.trace.at(-1)?.result;
      if (!last || last.ok || !last.content.includes(fixture.expected.errorIncludes)) {
        problems.push(`missing error ${JSON.stringify(fixture.expected.errorIncludes)}`);
      }
    }
    for (const [path, content] of Object.entries(fixture.expected.files ?? {})) {
      const actual = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
      if (actual !== content) problems.push(`file ${path}`);
    }
    if (fixture.id === "write-denied" || fixture.id === "escape-rejected") {
      if (existsSync(join(root, "out.txt"))) problems.push("denied write created out.txt");
    }

    if (problems.length > 0) {
      failures.push(`${fixture.id}: ${problems.join("; ")}`);
      console.log(`FAIL  ${fixture.id}`);
    } else {
      passed += 1;
      console.log(`PASS  ${fixture.id.padEnd(18)} tools=${tools.length} approvals=${result.approvals}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n${passed}/${FIXTURES.length} fixtures passed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
