import { useVance } from "../model/store";
import { PairScreen } from "./PairScreen";
import { Shell } from "./Shell";

export function App() {
  const s = useVance();

  // 口令错 / 设备被拒：不再显示一个连不上的会话壳，直接回配对页
  if (s.link.phase === "rejected" || s.link.phase === "denied") {
    return (
      <PairScreen
        error={s.link.phase === "rejected" ? "口令无效，请重新配对。" : "这台设备被拒绝接入，请重新配对。"}
      />
    );
  }

  return <Shell />;
}
