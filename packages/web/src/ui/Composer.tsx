import { useEffect, useRef, useState } from "react";

interface Props {
  canSend: boolean;
  canStop: boolean;
  hint: string;
  autoFocus?: boolean;
  onSend: (text: string) => boolean;
  onStop: () => void;
}

export function Composer({ canSend, canStop, hint, autoFocus, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const t = text.trim();
    if (!t || !canSend) return;
    // 不本地画气泡：服务端会把它记进流水再回推，避免一份话出现两次
    if (onSend(t)) {
      setText("");
      if (area.current) area.current.style.height = "auto";
    }
  };

  return (
    <div className="composer">
      <div className="composer-row">
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder="跟电脑上的 Agent 说话…"
          onChange={(e) => {
            setText(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {canStop ? (
          <button className="send stop" type="button" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="send" type="button" disabled={!canSend || !text.trim()} onClick={submit}>
            发送
          </button>
        )}
      </div>
      <div className={`hint ${canSend ? "hint-ok" : ""}`}>{hint}</div>
    </div>
  );
}
