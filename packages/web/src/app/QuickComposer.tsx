import { useEffect, useRef, useState } from "react";

/** 首页底部“对 Agent 说”：不切页，滑上一层输入控制条。 */
export function QuickComposer({
  canSend,
  canStop,
  hint,
  title,
  onSend,
  onStop,
  onClose,
}: {
  canSend: boolean;
  canStop: boolean;
  hint: string;
  title: string;
  onSend: (text: string) => boolean;
  onStop: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => area.current?.focus(), 90);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || !canSend) return;
    if (onSend(t)) {
      setText("");
      setSent(true);
      if (area.current) {
        area.current.style.height = "auto";
        area.current.focus();
      }
    }
  };

  return (
    <div className="quick-mask" onClick={onClose}>
      <div className="quick-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-grab" />
        <div className="quick-head">
          <span>对 Agent 说</span>
          <small>{title}</small>
          <button type="button" onClick={onClose} aria-label="收起">
            ✕
          </button>
        </div>
        <textarea
          ref={area}
          rows={2}
          value={text}
          placeholder="说一句，电脑上就开始做…"
          onChange={(e) => {
            setText(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="quick-foot">
          <span className={`quick-hint${sent ? " sent" : ""}`}>
            {sent ? "已发送，电脑收到后会更新状态" : hint}
          </span>
          {canStop ? (
            <button className="quick-send stop" type="button" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="quick-send" type="button" disabled={!canSend || !text.trim()} onClick={submit}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
