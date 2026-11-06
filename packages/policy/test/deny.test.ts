import { describe, expect, it } from "vitest";
import { checkDeny, classifyApproval } from "../src/index.js";

/**
 * 禁止清单只读 facts：目标路径、程序名、适配器报上来的 danger。
 */

describe("路径禁区：写/删禁止，读不禁止", () => {
  it("写 Program Files：禁止", () => {
    expect(
      checkDeny({ action_display: "随便写", facts: { kind: "edit", writes: ["C:\\Program Files\\evil.txt"] } })?.deny,
    ).toBe(true);
  });

  it("删 Windows 目录：禁止", () => {
    expect(
      checkDeny({ action_display: "随便写", facts: { kind: "edit", deletes: ["C:\\Windows\\System32\\x.dll"] } })
        ?.deny,
    ).toBe(true);
  });

  it("读 Program Files：不禁止（只读不是写）", () => {
    expect(
      checkDeny({ action_display: "随便写", facts: { kind: "read", reads: ["C:\\Program Files\\app\\a.txt"] } }),
    ).toBeNull();
  });

  it("写桌面：不禁止", () => {
    expect(
      checkDeny({ action_display: "随便写", facts: { kind: "edit", writes: ["C:\\Users\\1\\Desktop\\a.txt"] } }),
    ).toBeNull();
  });
});

describe("适配器报上来的 danger / program", () => {
  it("格式化磁盘：禁止，理由是适配器给的事实", () => {
    const v = checkDeny({ action_display: "Format-Volume -DriveLetter D", facts: { danger: "磁盘级操作" } });
    expect(v?.deny).toBe(true);
    expect(v?.reason).toContain("磁盘级操作");
  });

  it("程序名在黑名单：禁止（不需要解析命令）", () => {
    expect(checkDeny({ action_display: "x", facts: { kind: "execute", program: "diskpart" } })?.deny).toBe(true);
  });

  it("普通程序：不禁止", () => {
    expect(checkDeny({ action_display: "x", facts: { kind: "execute", program: "soffice" } })).toBeNull();
  });
});

describe("禁止优先于记住", () => {
  it("就算记住过，写 Program Files 还是禁止", () => {
    const event = { action_display: "写", facts: { kind: "edit", effect: "write", writes: ["C:\\Program Files\\x"] } };
    const v = classifyApproval(event, ["edit||C:\\Program Files\\x"]);
    expect(v.deny).toBe(true);
  });
});

describe("换一个 Agent：只换 facts，不换策略", () => {
  it("JSON 工具调用的写/读走同一条规则", () => {
    // 假设另一个适配器把 write_file 翻译成这种 facts；策略代码一行不改
    const write = {
      action_display: 'write_file(path="C:\\\\Windows\\\\x")',
      facts: { kind: "write", effect: "write", writes: ["C:\\Windows\\x"] },
    };
    expect(classifyApproval(write).deny).toBe(true);

    const read = {
      action_display: 'read_file(path="C:\\\\Windows\\\\x")',
      facts: { kind: "read", effect: "read", reads: ["C:\\Windows\\x"] },
    };
    expect(classifyApproval(read).auto).toBe(true);
  });
});
