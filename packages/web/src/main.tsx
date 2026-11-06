import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { store } from "./model/store";
import { boot } from "./net/ws";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("没有 #root");

createRoot(root).render(<App />);
boot();

// dev 下暴露状态，供截图脚本核对「四轴没有互相覆盖」
if (import.meta.env.DEV) {
  (window as unknown as { __vance: () => unknown }).__vance = () => store.getSnapshot();
}
