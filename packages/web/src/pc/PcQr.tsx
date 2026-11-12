import { useMemo } from "react";

/**
 * 设计/预览用二维码样式。
 *
 * 真机配对码由 Host 生成；这里只画一个稳定的占位图，
 * 不对应可扫描的地址，避免把假 token 画成“能扫”。
 */
export function PcQr({ size = 180, muted = false }: { size?: number; muted?: boolean }) {
  const cells = useMemo(() => {
    const n = 25;
    const out: boolean[] = [];
    const finder = (x: number, y: number): boolean | null => {
      for (const [ox, oy] of [
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ]) {
        const dx = x - ox;
        const dy = y - oy;
        if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
          const border = dx === 0 || dx === 6 || dy === 0 || dy === 6;
          const center = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          return border || center;
        }
        if (dx >= -1 && dx < 8 && dy >= -1 && dy < 8) return false;
      }
      return null;
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const f = finder(x, y);
        out.push(f !== null ? f : (x * 3 + y * 5 + x * y) % 7 < 3);
      }
    }
    return out;
  }, []);

  return (
    <div
      className={`pc-qr${muted ? " muted" : ""}`}
      role="img"
      aria-label={muted ? "二维码占位" : "配对二维码预览"}
      style={{ width: size, height: size, gridTemplateColumns: "repeat(25, 1fr)", gridTemplateRows: "repeat(25, 1fr)" }}
    >
      {cells.map((on, i) => (
        <i key={i} className={on ? "on" : ""} />
      ))}
    </div>
  );
}
