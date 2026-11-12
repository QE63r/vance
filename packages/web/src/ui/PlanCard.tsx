import type { PlanEntry } from "../model/reduce";
import type { PlanMove } from "../model/types";
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

/** 优先用 host 汇总的 moves；没有就回到 steps[].facts.moves（兼容旧事件） */
function planMoves(plan: PlanEntry["event"]): PlanMove[] {
  if (Array.isArray(plan.moves) && plan.moves.length > 0) {
    return plan.moves
      .filter((m) => m && typeof m.from === "string" && typeof m.to === "string" && m.from && m.to)
      .map((m) => ({ from: m.from, to: m.to }));
  }
  const out: PlanMove[] = [];
  for (const step of plan.steps) {
    const raw = step.facts?.moves;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const m = item as { from?: unknown; to?: unknown };
      const from = String(m.from ?? "");
      const to = String(m.to ?? "");
      if (from && to) out.push({ from, to });
    }
  }
  return out;
}

function reasonText(reason: string): string {
  if (reason === "target-missing") return "目标文件不在了";
  if (reason === "source-exists") return "原位置已有同名文件";
  return reason || "未知原因";
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
  const moves = planMoves(plan);
  const undo = entry.undo;
  const canUndo = entry.phase === "allowed" && moves.length > 0;

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

  // 撤销的是已经发生的移动，不是整份计划：写过的文件不回滚，这是边界。
  // 电脑上没清单（没批 / 已撤 / 从没移动过）时接口回 404/409，原样说人话。
  const undoMoves = async () => {
    if (!canUndo || !linkReady || undo?.phase === "running" || undo?.phase === "done") return;
    const title = moves.length === 1 ? "撤销这次移动？" : `撤销这 ${moves.length} 个移动？`;
    if (
      !window.confirm(
        `${title}\n\n会按电脑上的撤销清单把文件移回原处；已经写入或修改过的文件不会改回。`,
      )
    ) {
      return;
    }
    store.dispatch({ type: "undo-plan", planId: plan.plan_id });
    try {
      const res = await fetch(`/undo/${encodeURIComponent(plan.plan_id)}`, {
        method: "POST",
        headers: { "x-vance-token": getToken() },
      });
      const body = (await res.json().catch(() => ({}))) as {
        moved?: unknown;
        failed?: Array<{ from?: unknown; to?: unknown; reason?: unknown }>;
        error?: unknown;
      };
      if (res.status === 404) throw new Error("电脑上没有可撤销的移动清单");
      if (res.status === 409) throw new Error("这份移动已经撤销过，不能重复撤销");
      if (!res.ok && !Array.isArray(body.failed)) throw new Error(`HTTP ${res.status}`);
      const failed = (Array.isArray(body.failed) ? body.failed : []).map((f) => ({
        from: String(f?.from ?? ""),
        to: String(f?.to ?? ""),
        reason: String(f?.reason ?? ""),
      }));
      store.dispatch({
        type: "undo-result",
        planId: plan.plan_id,
        moved: Number(body.moved) || 0,
        failed,
      });
    } catch (err) {
      store.dispatch({
        type: "undo-result",
        planId: plan.plan_id,
        moved: 0,
        failed: [],
        error: `撤销失败：${err instanceof Error ? err.message : String(err)}`.slice(0, 120),
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

      {canUndo && (
        <div className="plan-undo">
          {undo?.phase === "running" && (
            <button className="btn" type="button" disabled>
              撤销中…
            </button>
          )}

          {undo?.phase === "done" && (
            <div className="plan-undo-ok">
              {undo.moved > 0 ? `已撤销 ${undo.moved} 个移动` : "没有需要撤销的移动"}
            </div>
          )}

          {(undo?.phase === "partial" || undo?.phase === "failed") && (
            <>
              {undo.failed.length > 0 && (
                <div className="plan-undo-warn">
                  撤销了 {undo.moved} 个，{undo.failed.length} 个没成功：
                  {undo.failed.map((f) => reasonText(f.reason)).join("；")}
                </div>
              )}
              {undo.error && <div className="card-error">{undo.error}</div>}
              <button className="btn" type="button" disabled={!linkReady} onClick={() => void undoMoves()}>
                重试撤销
              </button>
              <div className="plan-undo-note">只重试清单里还没成功的移动。</div>
            </>
          )}

          {!undo && (
            <>
              <button className="btn" type="button" disabled={!linkReady} onClick={() => void undoMoves()}>
                撤销这次移动（{moves.length}）
              </button>
              <div className="plan-undo-note">按电脑上的撤销清单移回原处；已经写过的文件不会改回。</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
