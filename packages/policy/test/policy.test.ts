import { describe, expect, it } from "vitest";
import { classifyApproval, classifyCommand } from "../src/index.js";

/**
 * 最重要的不是"能放行"，是"不会被绕过"。
 * 后半部分每一条都是尝试绕过白名单的写法，必须全部判成"要问人"。
 */

describe("只读命令：放行", () => {
  const allowed = [
    "Get-ChildItem -Force",
    "Get-ChildItem -Force | Select-Object Mode, Length, Name",
    "Test-Path -LiteralPath data.csv",
    "Get-Content notes.txt",
    "ls -la",
    "git status",
    "Get-ChildItem | Measure-Object",
    "Get-ChildItem; Get-Content a.txt",
  ];

  for (const cmd of allowed) {
    it(`放行：${cmd.slice(0, 40)}`, () => {
      expect(classifyCommand(cmd).auto).toBe(true);
    });
  }
});

describe("写操作与组合：必须问人", () => {
  const mustAsk = [
    ['Remove-Item -LiteralPath "data.csv"', "删除"],
    ["Get-ChildItem; Remove-Item data.csv", "分号拼接"],
    ["Get-ChildItem | ForEach-Object { Remove-Item $_ }", "管道里藏删除"],
    ["Get-Content a.txt > b.txt", "重定向写文件"],
    ["Get-Content a.txt >> b.txt", "追加重定向"],
    ["echo $(Remove-Item x)", "子表达式"],
    ["Get-ChildItem `n Remove-Item x", "反引号"],
    ["& C:\\Windows\\System32\\cmd.exe /c del x", "调用运算符"],
    ["rm -rf /", "rm"],
    ["del data.csv", "del"],
    ["mv a b", "移动"],
    ["Set-Content a.txt hello", "写文件"],
    ["Invoke-WebRequest https://example.com", "联网"],
    ["Get-ChildItem\nRemove-Item x", "换行拼接"],
  ];

  for (const [cmd, why] of mustAsk) {
    it(`问人（${why}）：${cmd.slice(0, 36)}`, () => {
      expect(classifyCommand(cmd).auto).toBe(false);
    });
  }
});

describe("审批请求", () => {
  it("纯路径访问：静默放行（这就是手机被刷屏的原因）", () => {
    const v = classifyApproval({ action_display: "C:\\Users\\1\\Desktop", facts: { kind: "other" } });
    expect(v.auto).toBe(true);
  });

  it("执行类：交给命令规则", () => {
    expect(
      classifyApproval({ action_display: "Get-ChildItem -Force", facts: { kind: "execute" } }).auto,
    ).toBe(true);
    expect(
      classifyApproval({ action_display: 'Remove-Item -LiteralPath "a.csv"', facts: { kind: "execute" } })
        .auto,
    ).toBe(false);
  });

  it("编辑类：一律问人", () => {
    expect(
      classifyApproval({ action_display: "C:\\a\\all.md", facts: { kind: "edit" } }).auto,
    ).toBe(false);
  });

  it("进程类抓取：一律问人", () => {
    expect(
      classifyApproval({ action_display: "https://example.com", facts: { kind: "fetch" } }).auto,
    ).toBe(false);
  });
});
