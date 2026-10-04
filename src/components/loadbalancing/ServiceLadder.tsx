"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Mono, Pill, Segmented } from "../ui";

type SvcType = "ClusterIP" | "NodePort" | "LoadBalancer";
type Impl = "none" | "metallb-l2" | "metallb-bgp" | "cilium-l2" | "cilium-bgp";

const IMPLS: { value: Impl; label: string }[] = [
  { value: "none", label: "nothing installed" },
  { value: "metallb-l2", label: "MetalLB L2" },
  { value: "metallb-bgp", label: "MetalLB BGP" },
  { value: "cilium-l2", label: "Cilium L2" },
  { value: "cilium-bgp", label: "Cilium BGP" },
];

const NODES = [
  { name: "worker-1", ip: "192.168.1.11", pods: ["web-7d4f-a"] },
  { name: "worker-2", ip: "192.168.1.12", pods: ["web-7d4f-b"] },
  { name: "worker-3", ip: "192.168.1.13", pods: [] as string[] },
];
const NODE_X = 400;
const NODE_W = 340;
const NODE_H = 96;
const nodeY = (i: number) => 14 + i * 116;
const nodeMid = (i: number) => nodeY(i) + NODE_H / 2;
const CLIENT = { x: 14, y: 160, w: 120, h: 60 };
const VIP = "192.168.1.240";
const NODEPORT = 31080;

const isBgp = (i: Impl) => i.endsWith("bgp");
const isL2 = (i: Impl) => i.endsWith("l2");

export function ServiceLadder() {
  const [type, setType] = useState<SvcType>("LoadBalancer");
  const [impl, setImpl] = useState<Impl>("metallb-l2");
  const [alive, setAlive] = useState([true, true, true]);
  const [leader, setLeader] = useState<number | null>(0);
  const [converging, setConverging] = useState<number | null>(null); // dead node whose routes are still being withdrawn
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const lb = type === "LoadBalancer" && impl !== "none";
  const pending = type === "LoadBalancer" && impl === "none";
  const aliveCount = alive.filter(Boolean).length;

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setAlive([true, true, true]);
    setLeader(0);
    setConverging(null);
  }

  function kill(i: number) {
    if (!alive[i]) {
      setAlive((a) => a.map((v, j) => (j === i ? true : v)));
      if (leader === null) setLeader(i);
      return;
    }
    const next = alive.map((v, j) => (j === i ? false : v));
    setAlive(next);
    if (timer.current) clearTimeout(timer.current);
    if (lb && isL2(impl) && leader === i) {
      setLeader(null);
      timer.current = setTimeout(() => {
        const n = next.findIndex(Boolean);
        setLeader(n === -1 ? null : n);
      }, 2200);
    } else if (lb && isBgp(impl)) {
      setConverging(i);
      timer.current = setTimeout(() => setConverging(null), 2200);
    }
  }

  const killTarget = lb && isL2(impl) && leader !== null ? leader : alive.findIndex(Boolean);

  // edges into nodes
  const edges: { from: [number, number]; to: number; tone: "ok" | "bad" | "muted" }[] = [];
  const router = { x: 196, y: 160, w: 120, h: 60 };
  if (type === "NodePort") {
    NODES.forEach((_, i) => edges.push({ from: [CLIENT.x + CLIENT.w, CLIENT.y + CLIENT.h / 2], to: i, tone: alive[i] ? "ok" : "bad" }));
  } else if (lb && isL2(impl)) {
    if (leader !== null) edges.push({ from: [CLIENT.x + CLIENT.w, CLIENT.y + CLIENT.h / 2], to: leader, tone: "ok" });
  } else if (lb && isBgp(impl)) {
    NODES.forEach((_, i) => {
      if (alive[i]) edges.push({ from: [router.x + router.w, router.y + router.h / 2], to: i, tone: "ok" });
      else if (converging === i) edges.push({ from: [router.x + router.w, router.y + router.h / 2], to: i, tone: "bad" });
    });
  }

  const svcLine =
    type === "ClusterIP"
      ? `web   ClusterIP      10.96.12.34   <none>          80/TCP`
      : type === "NodePort"
        ? `web   NodePort       10.96.12.34   <none>          80:${NODEPORT}/TCP`
        : `web   LoadBalancer   10.96.12.34   ${pending ? "<pending>    " : VIP}   80:${NODEPORT}/TCP`;

  const status = (() => {
    if (type === "ClusterIP") return { tone: "info" as const, text: "Reachable only from inside the cluster. The ClusterIP is virtual: no interface owns it; kube-proxy (iptables/nftables/IPVS) or Cilium eBPF rewrites the destination to a ready pod on every node." };
    if (type === "NodePort") return { tone: "info" as const, text: `Every node listens on :${NODEPORT}, even worker-3 which runs no web pod: it just forwards. Clients must know node IPs and cope with nodes disappearing. That is why you rarely expose NodePorts directly.` };
    if (pending) return { tone: "bad" as const, text: "On bare metal / Proxmox nobody answers the LoadBalancer request. The Service gets a ClusterIP and a NodePort, but EXTERNAL-IP stays <pending> forever. A cloud gets this from its cloud-controller-manager; at home you install MetalLB or enable Cilium LB IPAM." };
    if (isL2(impl)) {
      if (leader === null) return { tone: "warn" as const, text: `The node that answered ARP for ${VIP} is gone. Until another node is elected and sends gratuitous ARP, the VIP is a black hole (typically a few seconds; ${impl === "cilium-l2" ? "Cilium uses a Kubernetes Lease per Service, so it is bounded by the lease duration" : "MetalLB detects failure via memberlist"}).` };
      return { tone: "ok" as const, text: `${NODES[leader].name} is the only node answering ARP for ${VIP}. All traffic for this Service enters through that one node, then kube-proxy / eBPF spreads it to pods. Simple, works on any flat L2 network, but no real load balancing between nodes: one node's NIC is the ceiling.` };
    }
    if (converging !== null) return { tone: "warn" as const, text: `${NODES[converging].name} died. The router keeps its route until the BGP session drops (hold timer, or sub-second with BFD), then withdraws it and re-hashes flows over the survivors.` };
    return { tone: "ok" as const, text: `Every node advertises ${VIP}/32 to the router over BGP. The router installs ${aliveCount} equal-cost next hops (ECMP) and hashes each flow to one of them: real multi-node load spreading. Needs a BGP-capable router (OPNsense/FRR, MikroTik, a ToR switch…).` };
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={type} onChange={(t) => { setType(t); reset(); }} options={["ClusterIP", "NodePort", "LoadBalancer"] as const} />
        {type === "LoadBalancer" && (
          <Segmented value={impl} onChange={(v) => { setImpl(v); reset(); }} options={IMPLS} />
        )}
      </div>

      <div className="overflow-x-auto">
        <svg viewBox="0 0 760 360" className="w-full min-w-[560px]" role="img" aria-label={`Service type ${type} traffic diagram`}>
          {/* client */}
          <g>
            <rect x={CLIENT.x} y={CLIENT.y} width={CLIENT.w} height={CLIENT.h} rx="10" className="fill-panel-2 stroke-line" />
            <text x={CLIENT.x + CLIENT.w / 2} y={CLIENT.y + 25} textAnchor="middle" className="fill-ink text-[12px] font-medium">
              {type === "ClusterIP" ? "pod (in-cluster)" : "client on LAN"}
            </text>
            <text x={CLIENT.x + CLIENT.w / 2} y={CLIENT.y + 43} textAnchor="middle" className="fill-faint font-mono text-[10px]">
              {type === "ClusterIP" ? "web.default.svc:80" : type === "NodePort" ? `<nodeIP>:${NODEPORT}` : pending ? "??? no IP" : `${VIP}:80`}
            </text>
          </g>

          {/* ClusterIP virtual box */}
          {type === "ClusterIP" && (
            <g>
              <rect x="190" y="150" width="150" height="80" rx="10" strokeDasharray="5 5" className="fill-none stroke-accent-2" />
              <text x="265" y="180" textAnchor="middle" className="fill-ink text-[12px]">ClusterIP</text>
              <text x="265" y="197" textAnchor="middle" className="fill-faint font-mono text-[10px]">10.96.12.34:80</text>
              <text x="265" y="215" textAnchor="middle" className="fill-faint text-[9.5px]">virtual — rules on every node</text>
              <line x1={CLIENT.x + CLIENT.w} y1="190" x2="190" y2="190" strokeDasharray="6 6" className="animate-dash stroke-ok" strokeWidth="2" />
              {NODES.map((n, i) =>
                n.pods.map((p) => (
                  <line key={p} x1="340" y1="190" x2={NODE_X + 200} y2={nodeMid(i) + 14} strokeDasharray="6 6" className={clsx("animate-dash", alive[i] ? "stroke-ok" : "stroke-bad/50")} strokeWidth="1.5" />
                )),
              )}
            </g>
          )}

          {/* pending */}
          {pending && (
            <g>
              <rect x="190" y="150" width="150" height="80" rx="10" strokeDasharray="4 4" className="fill-bad/5 stroke-bad" />
              <text x="265" y="185" textAnchor="middle" className="fill-bad text-[12px]">EXTERNAL-IP</text>
              <text x="265" y="203" textAnchor="middle" className="animate-pulse-soft fill-bad font-mono text-[11px]">&lt;pending&gt;</text>
            </g>
          )}

          {/* L2 VIP tag */}
          {lb && isL2(impl) && (
            <g>
              <text x="265" y="150" textAnchor="middle" className="fill-faint text-[10px]">who-has {VIP}? (ARP)</text>
              {leader === null && (
                <text x="265" y="240" textAnchor="middle" className="animate-pulse-soft fill-warn text-[11px]">electing new leader…</text>
              )}
            </g>
          )}

          {/* BGP router */}
          {lb && isBgp(impl) && (
            <g>
              <line x1={CLIENT.x + CLIENT.w} y1="190" x2={router.x} y2="190" strokeDasharray="6 6" className="animate-dash stroke-ok" strokeWidth="2" />
              <rect x={router.x} y={router.y} width={router.w} height={router.h} rx="10" className="fill-panel-2 stroke-accent-2" />
              <text x={router.x + router.w / 2} y={router.y + 24} textAnchor="middle" className="fill-ink text-[12px]">router (BGP)</text>
              <text x={router.x + router.w / 2} y={router.y + 42} textAnchor="middle" className="fill-faint font-mono text-[10px]">
                {VIP}/32 ×{alive.filter(Boolean).length + (converging !== null ? 1 : 0)} ECMP
              </text>
            </g>
          )}

          {/* edges */}
          {edges.map((e, k) => (
            <path
              key={k}
              d={`M${e.from[0]},${e.from[1]} C${(e.from[0] + NODE_X) / 2},${e.from[1]} ${(e.from[0] + NODE_X) / 2},${nodeMid(e.to)} ${NODE_X},${nodeMid(e.to)}`}
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 6"
              className={clsx("animate-dash transition-all", e.tone === "ok" ? "stroke-ok" : "stroke-bad")}
            />
          ))}

          {/* nodes */}
          {NODES.map((n, i) => {
            const isLeader = lb && isL2(impl) && leader === i;
            return (
              <g key={n.name} className={clsx("transition-opacity duration-500", !alive[i] && "opacity-35")}>
                <rect
                  x={NODE_X}
                  y={nodeY(i)}
                  width={NODE_W}
                  height={NODE_H}
                  rx="12"
                  className={clsx("fill-panel-2 transition-colors", isLeader ? "stroke-accent" : alive[i] ? "stroke-line" : "stroke-bad")}
                  strokeWidth={isLeader ? 2 : 1}
                />
                <text x={NODE_X + 14} y={nodeY(i) + 22} className="fill-ink text-[12px] font-medium">
                  {n.name} {!alive[i] && "✕ down"}
                </text>
                <text x={NODE_X + 14} y={nodeY(i) + 38} className="fill-faint font-mono text-[10px]">{n.ip}</text>
                {type !== "ClusterIP" && (
                  <text x={NODE_X + 14} y={nodeY(i) + 58} className="fill-muted font-mono text-[10px]">:{NODEPORT} NodePort</text>
                )}
                {isLeader && (
                  <g>
                    <rect x={NODE_X + 14} y={nodeY(i) + 66} width="124" height="18" rx="9" className="fill-accent/15 stroke-accent/60" />
                    <text x={NODE_X + 76} y={nodeY(i) + 79} textAnchor="middle" className="fill-accent font-mono text-[10px]">owns VIP {VIP.split(".").slice(-1)}</text>
                  </g>
                )}
                {lb && isBgp(impl) && alive[i] && (
                  <text x={NODE_X + 14} y={nodeY(i) + 80} className="fill-info font-mono text-[10px]">announces {VIP}/32</text>
                )}
                {n.pods.length === 0 ? (
                  <text x={NODE_X + 200} y={nodeMid(i) + 18} className="fill-faint text-[10.5px]">no web pod here</text>
                ) : (
                  n.pods.map((p) => (
                    <g key={p}>
                      <rect x={NODE_X + 196} y={nodeMid(i) + 2} width="128" height="26" rx="7" className={clsx(alive[i] ? "fill-ok/10 stroke-ok/60" : "fill-bad/10 stroke-bad/50")} />
                      <text x={NODE_X + 260} y={nodeMid(i) + 19} textAnchor="middle" className="fill-ink font-mono text-[10.5px]">{p}</text>
                    </g>
                  ))
                )}
                {type !== "ClusterIP" && alive[i] && (
                  <text x={NODE_X + 200} y={nodeY(i) + 22} className="fill-faint text-[10px]">kube-proxy / eBPF → any ready pod</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {NODES.map((n, i) => (
          <Button key={n.name} variant={alive[i] ? "danger" : "default"} onClick={() => kill(i)}>
            {alive[i] ? `Kill ${n.name}` : `Revive ${n.name}`}
          </Button>
        ))}
        {lb && killTarget >= 0 && (
          <Pill color="var(--color-accent)">{isL2(impl) ? "tip: kill the VIP owner" : "tip: kill any node"}</Pill>
        )}
        <Button variant="ghost" onClick={reset}>Reset</Button>
      </div>

      <Callout tone={status.tone}>{status.text}</Callout>

      <Mono>
        <span className="text-faint">$ kubectl get svc web{"\n"}NAME  TYPE           CLUSTER-IP    EXTERNAL-IP     PORT(S){"\n"}</span>
        {svcLine}
      </Mono>
    </div>
  );
}
