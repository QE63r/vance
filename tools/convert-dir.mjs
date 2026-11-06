// 把某个目录下的 .doc/.docx 批量转成 PDF。
//
// 优先用 LibreOffice 的命令行（稳定、不需要激活、不弹窗）；
// 没有 LibreOffice 时，退回到 Word COM。
// 路径由 Node 直接传给子进程（UTF-16），不经过 cmd，所以中文不会被搞坏。
import { readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2];
const outDir = process.argv[3] || join(dir, "PDF");

if (!dir) {
  console.error("用法: node tools/convert-dir.mjs <目录> [输出目录]");
  process.exit(1);
}
if (!existsSync(dir)) {
  console.error("目录不存在:", dir);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const SOFFICE_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];
const soffice = SOFFICE_CANDIDATES.find((p) => existsSync(p));

const files = readdirSync(dir).filter((f) => [".doc", ".docx"].includes(extname(f).toLowerCase()));
if (files.length === 0) {
  console.log("目录里没有 .doc/.docx");
  process.exit(0);
}

console.log(`转换器: ${soffice ? "LibreOffice" : "Word COM（回退）"}`);
console.log(`输出目录: ${outDir}`);
console.log("");

let ok = 0;
let fail = 0;

for (const f of files) {
  const src = join(dir, f);
  const expect = join(outDir, basename(f, extname(f)) + ".pdf");
  const started = Date.now();

  if (soffice) {
    // LibreOffice 首次运行要建用户配置（十几秒），第一次常常超时——重试一次
    const attempt = () =>
      spawnSync(
        soffice,
        ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", outDir, src],
        { encoding: "utf8", timeout: 120000 },
      );
    let r = attempt();
    if (!existsSync(expect)) r = attempt();
    const err = (r.stderr || "").trim().slice(0, 120);
    if (existsSync(expect)) {
      const kb = Math.round(statSync(expect).size / 1024);
      console.log(`✓ ${f} → ${basename(expect)} (${kb} KB, ${Date.now() - started}ms)`);
      ok += 1;
    } else {
      console.log(`✗ ${f} 失败 ${err}`);
      fail += 1;
    }
  } else {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/doc2pdf.ps1", "-Path", src, "-OutDir", outDir],
      { encoding: "utf8", timeout: 120000 },
    );
    if (existsSync(expect)) {
      console.log(`✓ ${f} → ${basename(expect)}`);
      ok += 1;
    } else {
      console.log(`✗ ${f} 失败 ${(r.stdout || r.stderr || "").trim().slice(0, 120)}`);
      fail += 1;
    }
  }
}

console.log("");
console.log(`完成：成功 ${ok}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
