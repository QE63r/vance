// 把当前隧道地址画成一张二维码图片，方便直接看/扫/发。
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";

const urlFile = join(homedir(), ".vance", "tunnel-url.txt");
const url = readFileSync(urlFile, "utf8").trim();
const out = join(homedir(), ".vance", "qr.png");

await QRCode.toFile(out, url, {
  width: 720,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#11181f", light: "#ffffff" },
});

console.log(url);
console.log(out);
