import type { ModelAction } from "./index.js";

export interface ToyFixture {
  id: string;
  prompt: string;
  actions: ModelAction[];
  files?: Record<string, string>;
  approve?: boolean;
  expected: {
    final: string;
    tools: string[];
    approvals: number;
    files?: Record<string, string>;
    errorIncludes?: string;
  };
}

/**
 * Ten deterministic fixtures. They are intentionally small: each one isolates
 * one loop/tool/approval behavior. No API key or network is involved.
 */
export const FIXTURES: ToyFixture[] = [
  {
    id: "list-workspace",
    prompt: "List the workspace.",
    files: { "alpha.txt": "a", "beta.txt": "b" },
    actions: [
      { type: "tool", name: "list_dir", arguments: { path: "." } },
      { type: "final", text: "listed" },
    ],
    expected: { final: "listed", tools: ["list_dir"], approvals: 0 },
  },
  {
    id: "read-file",
    prompt: "Read notes.txt.",
    files: { "notes.txt": "hello" },
    actions: [
      { type: "tool", name: "read_file", arguments: { path: "notes.txt" } },
      { type: "final", text: "hello" },
    ],
    expected: { final: "hello", tools: ["read_file"], approvals: 0 },
  },
  {
    id: "write-approved",
    prompt: "Write a greeting.",
    approve: true,
    actions: [
      { type: "tool", name: "write_file", arguments: { path: "out.txt", content: "hi" } },
      { type: "final", text: "saved" },
    ],
    expected: {
      final: "saved",
      tools: ["write_file"],
      approvals: 1,
      files: { "out.txt": "hi" },
    },
  },
  {
    id: "write-denied",
    prompt: "Write without approval.",
    approve: false,
    actions: [
      { type: "tool", name: "write_file", arguments: { path: "out.txt", content: "nope" } },
      { type: "final", text: "denied" },
    ],
    expected: {
      final: "denied",
      tools: ["write_file"],
      approvals: 1,
      errorIncludes: "Denied by user",
    },
  },
  {
    id: "escape-rejected",
    prompt: "Try to write outside the workspace.",
    approve: true,
    actions: [
      { type: "tool", name: "write_file", arguments: { path: "../outside.txt", content: "x" } },
      { type: "final", text: "blocked" },
    ],
    expected: {
      final: "blocked",
      tools: ["write_file"],
      approvals: 1,
      errorIncludes: "escapes the workspace",
    },
  },
  {
    id: "unknown-tool",
    prompt: "Call a tool that does not exist.",
    actions: [
      { type: "tool", name: "delete_everything", arguments: {} },
      { type: "final", text: "unknown" },
    ],
    expected: {
      final: "unknown",
      tools: ["delete_everything"],
      approvals: 0,
      errorIncludes: "Unknown tool",
    },
  },
  {
    id: "read-then-write",
    prompt: "Read then update the file.",
    files: { "out.txt": "old" },
    approve: true,
    actions: [
      { type: "tool", name: "read_file", arguments: { path: "out.txt" } },
      { type: "tool", name: "write_file", arguments: { path: "out.txt", content: "new" } },
      { type: "final", text: "updated" },
    ],
    expected: {
      final: "updated",
      tools: ["read_file", "write_file"],
      approvals: 1,
      files: { "out.txt": "new" },
    },
  },
  {
    id: "final-only",
    prompt: "Just answer.",
    actions: [{ type: "final", text: "ready" }],
    expected: { final: "ready", tools: [], approvals: 0 },
  },
  {
    id: "overwrite",
    prompt: "Overwrite the file.",
    files: { "out.txt": "old" },
    approve: true,
    actions: [
      { type: "tool", name: "write_file", arguments: { path: "out.txt", content: "new" } },
      { type: "final", text: "overwritten" },
    ],
    expected: {
      final: "overwritten",
      tools: ["write_file"],
      approvals: 1,
      files: { "out.txt": "new" },
    },
  },
  {
    id: "missing-read",
    prompt: "Read a file that does not exist.",
    actions: [
      { type: "tool", name: "read_file", arguments: { path: "missing.txt" } },
      { type: "final", text: "missing" },
    ],
    expected: {
      final: "missing",
      tools: ["read_file"],
      approvals: 0,
      errorIncludes: "Not found",
    },
  },
];
