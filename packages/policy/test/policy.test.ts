import { describe, expect, it } from "vitest";
import { classifyApproval, treatKey } from "../src/index.js";

/**
 * 这一层只认 facts。命令原文（action_display）写得再吓人也不参与判定；
 * 两种语言写法只要事实相同，结论就必须相同。
 */

const shell = (facts: Record<string, unknown>, text: string) => ({ action_display: text, facts });

describe("只读：放行", () => {
  it("effect=read：命令文本写着 rm 也放行（文本不参与判定）", () => {
    expect(classifyApproval(shell({ kind: "execute", effect: "read" }, 'rm -rf / && Remove-Item "x"')).auto).toBe(true);
  });

  it("旧事实：纯路径访问仍然放行", () => {
    expect(classifyApproval({ action_display: "C:\\Users\\1\\Desktop", facts: { kind: "other" } }).auto).toBe(true);
  });
});

describe("写与未知：问人", () => {
  it("effect=unknown：文本写着 ls 也要问", () => {
    expect(classifyApproval(shell({ kind: "execute", effect: "unknown" }, "ls -la")).auto).toBe(false);
  });

  it("edit：即使只改桌面的文件也要问", () => {
    expect(
      classifyApproval(shell({ kind: "edit", effect: "write", writes: ["C:\\Users\\1\\Desktop\\a.md"] }, "C:\\a.md"))
        .auto,
    ).toBe(false);
  });

  it("fetch / 未知类型：问人", () => {
    expect(classifyApproval(shell({ kind: "fetch", effect: "unknown" }, "https://example.com")).auto).toBe(false);
  });
});

describe("同一个事实，两种写法", () => {
  const facts = { kind: "execute", effect: "unknown", program: "rm" };
  it("PowerShell 与 bash 文本的判定相同", () => {
    const ps = classifyApproval(shell(facts, 'Remove-Item -LiteralPath "data.csv" -Force'));
    const bash = classifyApproval(shell(facts, "rm data.csv"));
    expect(ps.auto).toBe(bash.auto);
    expect(ps.reason).toBe(bash.reason);
  });

  it("记住的键只看 facts，不看命令原文", () => {
    const ps = { action_display: "Remove-Item data.csv", facts };
    const bash = { action_display: "rm data.csv", facts };
    expect(treatKey(ps)).toBe(treatKey(bash));
    expect(classifyApproval(ps, [treatKey(bash)]).auto).toBe(true);
  });
});

describe("权限档位", () => {
  const roots = ["C:\\Users\\1\\Desktop", "C:\\Users\\1\\Desktop\\梵境\\sandbox"];
  const edit = (path: string) => ({
    action_display: "写文件",
    facts: { kind: "edit", effect: "write", writes: [path] },
  });
  const runScript = (path: string) => ({
    action_display: "跑脚本",
    facts: { kind: "execute", effect: "unknown", script: path },
  });

  it("工作区：桌面内的写先问一次", () => {
    expect(classifyApproval(edit("C:\\Users\\1\\Desktop\\a.docx"), { profile: "workspace", workspaceRoots: roots }).auto).toBe(false);
  });

  it("工作区：写系统目录仍然禁止", () => {
    const v = classifyApproval(edit("C:\\Program Files\\evil.txt"), { profile: "workspace", workspaceRoots: roots });
    expect(v.deny).toBe(true);
  });

  it("工作区：运行工作区内的脚本先问一次", () => {
    expect(classifyApproval(runScript("C:\\Users\\1\\Desktop\\梵境\\sandbox\\build.ps1"), { profile: "workspace", workspaceRoots: roots }).auto).toBe(false);
  });

  it("只读：桌面写也要问", () => {
    expect(classifyApproval(edit("C:\\Users\\1\\Desktop\\a.docx"), { profile: "read-only", workspaceRoots: roots }).auto).toBe(false);
  });

  it("完全：工作区外的写也放行，但硬禁止仍拦", () => {
    expect(classifyApproval(edit("C:\\other\\a.txt"), { profile: "full", workspaceRoots: roots }).auto).toBe(true);
    expect(classifyApproval(edit("C:\\Windows\\x.dll"), { profile: "full", workspaceRoots: roots }).deny).toBe(true);
  });
});
