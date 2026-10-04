"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Stat, Toggle } from "../ui";

type Phase = "idle" | "draining" | "installing" | "rebooting" | "done";
type N = { id: string; cp: boolean; ver: string; phase: Phase };

const OLD = "v1.11.2";
const NEW = "v1.11.3";
const INIT: N[] = [
  { id: "cp-1", cp: true, ver: OLD, phase: "idle" },
  { id: "cp-2", cp: true, ver: OLD, phase: "idle" },
  { id: "cp-3", cp: true, ver: OLD, phase: "idle" },
  { id: "worker-1", cp: false, ver: OLD, phase: "idle" },
  { id: "worker-2", cp: false, ver: OLD, phase: "idle" },
  { id: "worker-3", cp: false, ver: OLD, phase: "idle" },
];
const SEQ: Phase[] = ["draining", "installing", "rebooting", "done"];
const busy = (n: N) => n.phase !== "idle" && n.phase !== "done";

export function RollingUpgrade() {
  const [nodes, setNodes] = useState<N[]>(INIT);
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "muted"; text: string }>({ tone: "muted", text: "Click Upgrade on a node, or let the planner roll through the cluster." });
  const [auto, setAuto] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const cpDown = nodes.filter((n) => n.cp && busy(n)).length;
  const quorum = 3 - cpDown >= 2;

  function upgrade(id: string, current: N[] = nodes) {
    const n = current.find((x) => x.id === id)!;
    if (busy(n) || n.ver === NEW) return false;
    if (n.cp && !force && current.some((x) => x.cp && x.id !== id && busy(x))) {
      setMsg({ tone: "bad", text: `refused: etcd member on ${current.find((x) => x.cp && busy(x))!.id} is not healthy — upgrading ${id} now would leave 1 of 3 members. (Use --force to override… don't.)` });
      return false;
    }
    setMsg({ tone: "muted", text: `${id}: ${n.cp ? "etcd healthy, " : ""}cordon → drain → write slot → reboot` });
    SEQ.forEach((p, k) => {
      timers.current.push(
        setTimeout(() => {
          setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, phase: p, ver: p === "done" ? NEW : x.ver } : x)));
        }, k * 900),
      );
    });
    return true;
  }

  // auto planner: one node at a time, control planes first
  useEffect(() => {
    if (!auto) return;
    if (nodes.some(busy)) return;
    const next = nodes.find((n) => n.ver !== NEW);
    if (!next) {
      setAuto(false);
      setMsg({ tone: "ok", text: `All nodes on ${NEW}. etcd never dropped below quorum, and at most one node's pods were moving at a time.` });
      return;
    }
    const t = setTimeout(() => upgrade(next.id, nodes), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, nodes]);

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setNodes(INIT);
    setAuto(false);
    setMsg({ tone: "muted", text: "Click Upgrade on a node, or let the planner roll through the cluster." });
  }

  const upgraded = nodes.filter((n) => n.ver === NEW).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setAuto(true)} disabled={auto}>
          ▶ Roll the cluster
        </Button>
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
        <div className="ml-auto">
          <Toggle checked={force} onChange={setForce} label={<span className="font-mono text-xs">--force</span>} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {nodes.map((n) => (
          <div
            key={n.id}
            className={clsx(
              "rounded-lg border p-2.5 transition-colors",
              busy(n) ? "border-warn/50 bg-warn/5" : n.ver === NEW ? "border-ok/40 bg-ok/5" : "border-line bg-panel-2/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink">{n.id}</span>
              <span className="text-[10px] text-faint">{n.cp ? "control plane · etcd" : "worker"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className={clsx("font-mono text-xs", n.ver === NEW ? "text-ok" : "text-muted")}>{n.ver}</span>
              {busy(n) ? (
                <span className="font-mono text-[11px] text-warn animate-pulse-soft">{n.phase}…</span>
              ) : n.ver === NEW ? (
                <span className="text-[11px] text-ok">✓ Ready</span>
              ) : (
                <Button className="!px-2 !py-0.5 text-xs" onClick={() => upgrade(n.id)} disabled={auto}>
                  Upgrade
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="upgraded" value={`${upgraded}/6`} />
        <Stat label="etcd healthy" value={`${3 - cpDown}/3`} tone={quorum ? (cpDown ? "warn" : "good") : "bad"} />
        <Stat label="k8s API" value={quorum ? "up" : "DOWN"} tone={quorum ? "good" : "bad"} />
        <Stat label="nodes draining" value={nodes.filter(busy).length} tone={nodes.filter(busy).length > 1 ? "warn" : undefined} />
      </div>
      <p
        aria-live="polite"
        className={clsx(
          "rounded-lg border p-3 text-sm",
          !quorum ? "border-bad/50 bg-bad/10 text-bad" : msg.tone === "bad" ? "border-bad/40 text-bad" : msg.tone === "ok" ? "border-ok/40 text-ok" : "border-line text-muted",
        )}
      >
        {!quorum ? "Two control planes are rebooting at once: etcd has 1 of 3 members, so the Kubernetes API can't write until one comes back. This is what the health check (and one-at-a-time) prevents." : msg.text}
      </p>
    </div>
  );
}
