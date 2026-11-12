import { describe, expect, it } from "vitest";
import { parseHash, tabHref, taskHref, tabTitle } from "../src/app/routing";

describe("控制塔路由", () => {
  it("空 hash / token hash / 旧 session hash 都默认进总览", () => {
    expect(parseHash("")).toEqual({ kind: "tab", tab: "overview" });
    expect(parseHash("#")).toEqual({ kind: "tab", tab: "overview" });
    expect(parseHash("#token=abc")).toEqual({ kind: "tab", tab: "overview" });
    expect(parseHash("#session=ses_1")).toEqual({ kind: "tab", tab: "overview" });
    expect(parseHash("#/unknown")).toEqual({ kind: "tab", tab: "overview" });
  });

  it("四个 tab 能互相切换，生成的地址能被解析回来", () => {
    for (const tab of ["overview", "agents", "artifacts", "control"] as const) {
      expect(tabHref(tab)).toBe(`#/${tab}`);
      expect(parseHash(tabHref(tab))).toEqual({ kind: "tab", tab });
      expect(tabTitle(tab)).toBeTruthy();
    }
  });

  it("任务详情带 id，能打开也能回到总览", () => {
    const href = taskHref("ses_中文 1");
    expect(href.startsWith("#/task/")).toBe(true);
    expect(parseHash(href)).toEqual({ kind: "task", id: "ses_中文 1" });
    expect(parseHash("#/overview")).toEqual({ kind: "tab", tab: "overview" });
  });
});
