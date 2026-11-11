import type { PlanEntry } from "../model/reduce";
import { store } from "../model/store";
import { getToken } from "../net/ws";

const KIND: Record<string, string> = {
  edit: "写文件",
  execute: "跑脚本",
  delete: "删除",
  read: "读取",
};

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function StepFacts({ facts }: { facts?: Record<string, unknown> }) {
  if (!facts) return null;
  const writes = asStrings(facts.writes);
  const deletes = asStrings(facts.deletes);
  const script = typeof facts.script === "string" ? facts.script : "";
  const program = typeof facts.program === "string" ? facts.program : "";
  const moves = Array.isArray(facts.moves)
    ? facts.moves
        .filter((m): m is { from: string; to: string } => Boolean(m && typeof m === "object"))
        .map((m) => {
          const item = m as { from?: unknown; to?: unknown };
          return { from: String(item.from ?? ""), to: String(item.to ?? "") };
        })
        .filter((m) => m.from && m.to)
    : [];
  const rows: Array<[string, string]> = [
    ...writes.map((p): [string, string] => ["写", p]),
    ...deletes.map((p): [string, string] => ["删", p]),
    ...moves.map((m): [string, string] => ["移动", `${m.from} → ${m.to}`]),
    ...(script ? ([["脚本", script]] as Array<[string, string]>) : []),
    ...(program ? ([["程序", program]] as Array<[string, string]>) : []),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="plan-facts">
      {rows.map(([label, value], i) => (
        <div className="plan-fact" key={`${label}:${i}`}>
          <span className="plan-fact-label">{label}</span>
          <code>{value}</code>
        </div>
      ))}
    </div>
  );
}

export function PlanCard({ entry, now, linkReady }: { entry: PlanEntry; now: number; linkReady: boolean }) {
  const plan = entry.event;
  const remaining = Math.max(0, Math.ceil((plan.expires_at - now) / 1000));
  const open = entry.phase === "offered" || entry.phase === "submitting";

  const decide = async (decision: "allow" | "reject") => {
    if (!open || !linkReady || entry.phase === "submitting") return;
    store.dispatch({ type: "plan-decide", planId: plan.plan_id, decision });
    try {
      const res = await fetch("/plan/decision", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": getToken() },
        body: JSON.stringify({ plan_id: plan.plan_id, decision }),
      });
      const body = (await res.json().catch(() => ({}))) as { plan?: { status?: string } };
      if (!res.ok || !body.plan?.status) throw new Error(`HTTP ${res.status}`);
      const status = body.plan.status === "allowed" ? "allowed" : body.plan.status === "expired" ? "expired" : "rejected";
      store.dispatch({
        type: "msg",
        msg: {
          type: "plan_decision",
          plan_id: plan.plan_id,
          status,
          decision: decision,
          by: "phone",
          at: Date.now(),
        },
      });
    } catch (err) {
      store.dispatch({
        type: "plan-error",
        planId: plan.plan_id,
        error: `没收到电脑确认，请重试（${String(err).slice(0, 60)}）`,
      });
    }
  };

  return (
    <div className={`card plan plan-${entry.phase}`}>
      <div className="card-kicker">
        {entry.phase === "offered" && <>计划待批准 · 还剩 {mmss(remaining)}</>}
        {entry.phase === "submitting" && <>提交中…</>}
        {entry.phase === "allowed" && <>计划已批准 · 计划内自动，计划外再问</>}
        {entry.phase === "rejected" && <>计划已拒绝</>}
        {entry.phase === "expired" && <>计划已过期</>}
      </div>

      {plan.title && <div className="plan-title">{plan.title}</div>}
      {entry.error && <div className="card-error">{entry.error}</div>}

      <div className="plan-steps">
        {plan.steps.map((step, i) => (
          <div className="plan-step" key={`${plan.plan_id}:${i}`}>
            <div className="plan-step-head">
              <span className="plan-step-index">{i + 1}</span>
              <span className="plan-step-kind">{KIND[step.kind ?? ""] ?? step.kind ?? "动作"}</span>
            </div>
            <div className="plan-step-action">{step.action_display}</div>
            <StepFacts facts={step.facts} />
          </div>
        ))}
      </div>

      {open && (
        <div className="plan-actions">
          <button className="btn deny" type="button" disabled={!linkReady || entry.phase === "submitting"} onClick={() => void decide("reject")}>
            拒绝
          </button>
          <button className="btn allow" type="button" disabled={!linkReady || entry.phase === "submitting"} onClick={() => void decide("allow")}>
            {entry.phase === "submitting" ? "提交中…" : "批准计划"}
          </button>
        </div>
      )}
    </div>
  );
}
