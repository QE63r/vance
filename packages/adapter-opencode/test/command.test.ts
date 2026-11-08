import { describe, expect, it } from "vitest";
import { classifyCommand, dangerOf, explainAction } from "../src/index.js";

/**
 * 命令方言只属于适配器。这里的判断会变成 facts.effect / facts.danger，
 * 控制面不再看命令原文。
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
    'chcp 65001 > $null; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-ChildItem -LiteralPath "C:\\Users\\1\\Desktop" -Directory | Select-Object Name | Format-Table -AutoSize | Out-String',
    "Get-ChildItem | Out-String",
  ];

  for (const cmd of allowed) {
    it(`放行：${cmd.slice(0, 40)}`, () => {
      expect(classifyCommand(cmd).auto).toBe(true);
    });
  }
});

describe("写操作与组合：必须问人", () => {
  const mustAsk: Array<[string, string]> = [
    ['Remove-Item -LiteralPath "data.csv"', "删除"],
    ["Get-ChildItem; Remove-Item data.csv", "分号拼接"],
    ["Get-ChildItem | ForEach-Object { Remove-Item $_ }", "管道里藏删除"],
    ["Get-Content a.txt > b.txt", "重定向写文件"],
    ["echo $(Remove-Item x)", "子表达式"],
    ["& C:\\Windows\\System32\\cmd.exe /c del x", "调用运算符"],
    ["rm -rf /", "rm"],
    ["Set-Content a.txt hello", "写文件"],
    ["Get-ChildItem\nRemove-Item x", "换行拼接"],
  ];

  for (const [cmd, why] of mustAsk) {
    it(`问人（${why}）：${cmd.slice(0, 36)}`, () => {
      expect(classifyCommand(cmd).auto).toBe(false);
    });
  }
});

describe("永久禁止：变成 facts.danger", () => {
  it("格式化 / 磁盘操作", () => {
    expect(dangerOf("Format-Volume -DriveLetter D")).toBeTruthy();
  });

  it("关机 / 改执行策略", () => {
    expect(dangerOf("Stop-Computer")).toBeTruthy();
    expect(dangerOf("Set-ExecutionPolicy Bypass")).toBeTruthy();
  });

  it("结束系统关键进程", () => {
    expect(dangerOf("Stop-Process -Name lsass")).toBeTruthy();
  });

  it("普通只读命令没有 danger", () => {
    expect(dangerOf("Get-ChildItem")).toBeNull();
  });
});

describe("人话解释（展示用）", () => {
  it("结束 explorer 会解释后果", () => {
    expect(explainAction("Stop-Process -Name explorer -Force")).toContain("桌面");
  });

  it("普通命令没有解释", () => {
    expect(explainAction("Get-ChildItem C:\\")).toBeNull();
  });
});
