"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Segmented, Stat } from "../ui";

type Policy = "Cluster" | "Local";

const CLIENT_IP = "203.0.113.7";
const NODES = [
  { name: "worker-1", ip: "192.168.1.11", y: 60 },
  { name: "worker-2", ip: "192.168.1.12", y: 175 },
  { name: "worker-3", ip: "192.168.1.13", y: 290 },
];
const PODS = [
  { name: "web-a", node: 0, y: 38 },
  { name: "web-b", node: 0, y: 82 },
  { name: "web-c", node: 1, y: 175 },
];
const C = { x: 70, y: 175 };
const LB = { x: 220, y: 175 };
const NODE_L = 340;
const NODE_R = 500;
const POD_X = 600;
const HC_PORT = 32411;

type Packet = { id: number; pts: [number, number][]; t0: number; dur: number; hop: boolean };

function pointAt(pts: [number, number][], f: number): [number, number] {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  let d = f * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i]) {
      const t = segs[i] === 0 ? 0 : d / segs[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export function TrafficPolicy() {
  const [policy, setPolicy] = useState<Policy>("Cluster");
  const [packets, setPackets] = useState<Packet[]>([]);
  const [now, setNow] = useState(0);
  const [hits, setHits] = useState([0, 0, 0]);
  const [seen, setSeen] = useState<(string | null)[]>([null, null, null]);
  const [hops, setHops] = useState(0);
  const [total, setTotal] = useState(0);
  const seq = useRef(0);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const healthy = (n: number) => policy === "Cluster" || PODS.some((p) => p.node === n);

  useEffect(() => {
    if (packets.length === 0) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      setPackets((ps) => ps.filter((p) => t - p.t0 < p.dur));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [packets.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => void (interval.current && clearInterval(interval.current)), []);

  function reset() {
    if (interval.current) clearInterval(interval.current);
    setHits([0, 0, 0]);
    setSeen([null, null, null]);
    setHops(0);
    setTotal(0);
    setPackets([]);
  }

  function sendOne(pol: Policy) {
    const nodes = NODES.map((_, i) => i).filter((i) => pol === "Cluster" || PODS.some((p) => p.node === i));
    const n = pick(nodes);
    const candidates = PODS.map((_, i) => i).filter((i) => pol === "Cluster" || PODS[i].node === n);
    const p = pick(candidates);
    const pod = PODS[p];
    const hop = pod.node !== n;
    const pts: [number, number][] = [
      [C.x, C.y],
      [LB.x, LB.y],
      [NODE_L, NODES[n].y],
      [NODE_R, NODES[n].y],
    ];
    if (hop) pts.push([NODE_R + 40, NODES[n].y], [NODE_R + 40, pod.y]);
    pts.push([POD_X, pod.y]);
    const id = ++seq.current;
    setPackets((ps) => [...ps, { id, pts, t0: performance.now(), dur: hop ? 1500 : 1150, hop }]);
    setHits((h) => h.map((v, i) => (i === p ? v + 1 : v)));
    // kube-proxy masquerades external NodePort traffic under Cluster policy, so the pod sees the node IP
    setSeen((s) => s.map((v, i) => (i === p ? (pol === "Cluster" ? NODES[n].ip : CLIENT_IP) : v)));
    setTotal((t) => t + 1);
    if (hop) setHops((h) => h + 1);
  }

  function burst(count: number) {
    if (interval.current) clearInterval(interval.current);
    let k = 0;
    const pol = policy;
    interval.current = setInterval(() => {
      sendOne(pol);
      if (++k >= count && interval.current) clearInterval(interval.current);
    }, 110);
  }

  const maxHits = Math.max(1, ...hits);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-faint">externalTrafficPolicy:</span>
        <Segmented value={policy} onChange={(v) => { setPolicy(v); reset(); }} options={["Cluster", "Local"] as const} />
        <Button variant="primary" onClick={() => burst(30)}>▶ Send 30 requests</Button>
        <Button onClick={() => sendOne(policy)}>Send 1</Button>
        <Button variant="ghost" onClick={reset}>Reset</Button>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox="0 0 760 350" className="w-full min-w-[560px]" role="img" aria-label={`externalTrafficPolicy ${policy} packet flow`}>
          {/* static links */}
          <line x1={C.x} y1={C.y} x2={LB.x} y2={LB.y} className="stroke-line" strokeWidth="2" />
          {NODES.map((n, i) => (
            <line key={n.name} x1={LB.x} y1={LB.y} x2={NODE_L} y2={n.y} strokeWidth="2" strokeDasharray={healthy(i) ? undefined : "4 5"} className={healthy(i) ? "stroke-line" : "stroke-bad/50"} />
          ))}
          {PODS.map((p) => (
            <line key={p.name} x1={NODE_R} y1={NODES[p.node].y} x2={POD_X} y2={p.y} className="stroke-line" strokeWidth="1.5" />
          ))}
          {policy === "Cluster" && (
            <g>
              <line x1={NODE_R + 40} y1={NODES[0].y} x2={NODE_R + 40} y2={NODES[2].y} strokeDasharray="3 4" className="stroke-warn/40" strokeWidth="1.5" />
              <text x={NODE_R + 46} y={NODES[2].y - 30} className="fill-warn/80 text-[10px]">node→node hop</text>
            </g>
          )}

          {/* client */}
          <circle cx={C.x} cy={C.y} r="30" className="fill-panel-2 stroke-line" />
          <text x={C.x} y={C.y - 2} textAnchor="middle" className="fill-ink text-[11px]">client</text>
          <text x={C.x} y={C.y + 12} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">{CLIENT_IP}</text>

          {/* LB */}
          <rect x={LB.x - 50} y={LB.y - 30} width="100" height="60" rx="10" className="fill-panel-2 stroke-accent-2" />
          <text x={LB.x} y={LB.y - 4} textAnchor="middle" className="fill-ink text-[11px]">LB / router</text>
          <text x={LB.x} y={LB.y + 12} textAnchor="middle" className="fill-faint text-[9px]">{policy === "Local" ? "health-checks nodes" : "all nodes eligible"}</text>

          {/* nodes */}
          {NODES.map((n, i) => (
            <g key={n.name}>
              <rect x={NODE_L} y={n.y - 36} width={NODE_R - NODE_L} height="72" rx="10" className={clsx("fill-panel-2", healthy(i) ? "stroke-line" : "stroke-bad/60")} />
              <text x={NODE_L + 12} y={n.y - 16} className="fill-ink text-[11.5px] font-medium">{n.name}</text>
              <text x={NODE_L + 12} y={n.y - 2} className="fill-faint font-mono text-[9.5px]">{n.ip}</text>
              {policy === "Local" ? (
                <text x={NODE_L + 12} y={n.y + 22} className={clsx("font-mono text-[9.5px]", healthy(i) ? "fill-ok" : "fill-bad")}>
                  :{HC_PORT}/healthz → {healthy(i) ? `200 (${PODS.filter((p) => p.node === i).length} local)` : "503 (0 local)"}
                </text>
              ) : (
                <text x={NODE_L + 12} y={n.y + 22} className="fill-muted font-mono text-[9.5px]">SNAT → {n.ip}</text>
              )}
            </g>
          ))}

          {/* pods */}
          {PODS.map((p, i) => (
            <g key={p.name}>
              <rect x={POD_X} y={p.y - 18} width="150" height="36" rx="8" className="fill-ok/10 stroke-ok/50" />
              <rect x={POD_X} y={p.y + 14} width={(150 * hits[i]) / maxHits} height="4" rx="2" className="fill-ok transition-all" />
              <text x={POD_X + 8} y={p.y - 3} className="fill-ink font-mono text-[10.5px]">{p.name} · {hits[i]}</text>
              <text x={POD_X + 8} y={p.y + 10} className={clsx("font-mono text-[9px]", seen[i] === CLIENT_IP ? "fill-ok" : "fill-faint")}>
                src: {seen[i] ?? "—"}
              </text>
            </g>
          ))}

          {/* packets */}
          {packets.map((p) => {
            const f = Math.min(1, Math.max(0, (now - p.t0) / p.dur));
            const [x, y] = pointAt(p.pts, f);
            return <circle key={p.id} cx={x} cy={y} r="5" className={p.hop ? "fill-warn" : "fill-accent"} />;
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="requests" value={total} />
        <Stat label="extra hops" value={total ? `${Math.round((100 * hops) / total)}%` : "—"} tone={hops ? "warn" : "neutral"} />
        <Stat label="client IP seen" value={total ? (policy === "Local" ? "100%" : "0%") : "—"} tone={total ? (policy === "Local" ? "good" : "bad") : "neutral"} />
        <Stat label="web-c share" value={total ? `${Math.round((100 * hits[2]) / total)}%` : "—"} tone={policy === "Local" && total > 10 ? "warn" : "neutral"} />
      </div>

      {policy === "Cluster" ? (
        <Callout tone="info" title="Cluster (default): even spread, lost source IP">
          Any node accepts the connection and kube-proxy picks any ready endpoint cluster-wide, so ~2/3 of requests landing on the &quot;wrong&quot; node take a second hop. To make the reply come back
          through the same node, kube-proxy SNATs external traffic to the node IP — your app logs, rate limiters and allow-lists see <code>192.168.1.x</code>, never <code>{CLIENT_IP}</code>. (Cilium&apos;s
          eBPF datapath in DSR mode can avoid this; standard kube-proxy cannot.)
        </Callout>
      ) : (
        <Callout tone="ok" title="Local: client IP preserved, no extra hop — but uneven">
          Nodes only forward to pods on themselves, so no SNAT is needed and the pod sees {CLIENT_IP}. kube-proxy opens a <code>healthCheckNodePort</code> that returns 503 on nodes with no local
          endpoint, so the LB (or MetalLB/Cilium, which only announce from nodes with endpoints) skips worker-3. The catch: traffic is split per <em>node</em>, so web-c alone gets ~half while
          web-a and web-b share the other half. Use topology spread constraints to keep replicas even across nodes.
        </Callout>
      )}
    </div>
  );
}
