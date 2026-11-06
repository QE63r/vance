// 把某个目录下的 .doc/.docx 批量转成 PDF。
// 文件名由 Node 读出、按 UTF-16 传给 PowerShell，避免中文路径在参数里被编码搞坏。
import { readdirSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2];
const outDir = process.argv[3] || join(dir, "PDF");

if (!dir) {
  console.error("用法: node tools/convert-dir.mjs <目录> [输出目录]");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const files = readdirSync(dir).filter((f) => [".doc", ".docx"].includes(extname(f).toLowerCase()));
if (files.length === 0) {
  console.log("目录里没有 .doc/.docx");
  process.exit(0);
}

for (const f of files) {
  const src = join(dir, f);
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/doc2pdf.ps1", "-Path", src, "-OutDir", outDir],
    { encoding: "utf8" },
  );
  const line = (r.stdout || "").trim() || (r.stderr || "").trim().slice(0, 200);
  console.log(`${basename(f)} → ${line}`);
}
