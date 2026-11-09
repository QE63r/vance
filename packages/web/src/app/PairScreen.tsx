import { useState } from "react";
import { parsePairingLink, saveCredentials } from "../net/credentials";

/**
 * 配对页。
 *
 * 正常情况下手机是扫电脑上的二维码打开的，地址里带 token，会直接进；
 * 这个页面主要处理：没有凭据、token 被拒、用户主动“忘记设备”。
 */
export function PairScreen({ error }: { error?: string }) {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = () => {
    const parsed = parsePairingLink(input);
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    const { endpoint, token } = parsed.credentials;
    setLocalError("");

    // 装在这个入口的 PWA 只能连这个入口；别的电脑就跳过去，让那台电脑的页面自己配对
    if (endpoint !== location.origin) {
      location.href = `${endpoint}/app/?token=${encodeURIComponent(token)}`;
      return;
    }

    saveCredentials(parsed.credentials, localStorage);
    location.replace(location.pathname);
  };

  return (
    <div className="pair">
      <div className="pair-mark">梵</div>
      <h1 className="pair-title">连接你的电脑</h1>
      <p className="pair-desc">
        在电脑的“梵境 Vance”窗口里按 <b>v</b>，会出现二维码和地址。
        手机扫二维码最省事；也可以把完整地址粘到下面。
      </p>

      <form
        className="pair-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="pair-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://…ts.net/app/?token=…"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="电脑上的完整地址"
        />
        <button className="pair-btn" type="submit" disabled={!input.trim()}>
          连接
        </button>
      </form>

      {(localError || error) && <div className="pair-error">{localError || error}</div>}

      <div className="pair-note">
        口令只存在这台手机的浏览器里；换手机或清除浏览器数据后，要重新扫码。
        <br />
        地址和口令等于电脑的控制权，别发给别人。
      </div>
    </div>
  );
}
