// 在 Node 里跑一遍页面脚本，喂一条审批事件，看看卡片到底渲染成什么样。
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(
  String.raw`<repo>\packages\host\public\index.html`,
  "utf8",
);

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://127.0.0.1:8787/?token=test",
  beforeParse(win) {
    class FakeWS {
      constructor() {
        this.readyState = 1;
        this.OPEN = 1;
        win.__ws = this; // 让外面拿到这个实例，才能给它喂消息
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send() {}
      close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }
    }
    win.WebSocket = FakeWS;
    win.CSS = win.CSS || { escape: (s) => String(s) };
    win.navigator.vibrate = () => {};
    win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    win.scrollTo = () => {};
    win.Element.prototype.scrollIntoView = () => {};
  },
});

const { window } = dom;
const doc = window.document;

const ev = {
  type: "approval_request",
  request_id: "req_test_1",
  action_display: 'Remove-Item -LiteralPath "data.csv"',
  facts: { kind: "execute", files: "data.csv" },
  preview: "",
  raw_digest: "a".repeat(64),
  raw_ref: { key: "a".repeat(64), length: 120 },
  expires_at: Date.now() + 120000,
};

setTimeout(() => {
  const ws = window.__ws;
  if (!ws || !ws.onmessage) {
    console.log("没拿到 ws 或 onmessage");
    process.exit(1);
  }
  ws.onmessage({
    data: JSON.stringify({ type: "history", items: [{ type: "event", event: ev }] }),
  });

  setTimeout(() => {
    const cards = doc.querySelectorAll(".card");
    console.log("卡片数量:", cards.length);
    for (const c of cards) {
      console.log("---- card ----");
      console.log("高度:", c.offsetHeight, "宽度:", c.offsetWidth);
      console.log("子节点:", [...c.children].map((x) => x.className || x.tagName).join(" | "));
      console.log(c.outerHTML.slice(0, 700));
    }
    process.exit(0);
  }, 100);
}, 300);
