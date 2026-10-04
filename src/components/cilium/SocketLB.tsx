"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Segmented, Stat } from "../ui";

const STAGES = [
  { x: 4, label: "app", sub: "connect(10.96.120.15:80)" },
  { x: 29, label: "socket hook", sub: "cgroup/connect4" },
  { x: 54, label: "tc / netfilter", sub: "per-packet NAT point" },
  { x: 78, label: "wire", sub: "node → node" },
  { x: 96, label: "backend", sub: "10.244.2.7:8080" },
];

type Pkt = { id: number; start: number };

export function SocketLB() {
  const [sock, setSock] = useState(true);
  const [pkts, setPkts] = useState<Pkt[]>([]);
  const [now, setNow] = useState(0);
  const idRef = useRef(0);
  const DUR = 2600;

  const live = pkts.some((p) => now - p.start < DUR);
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  function burst() {
    const t = performance.now();
    setNow(t);
    setPkts(Array.from({ length: 8 }, (_, k) => ({ id: ++idRef.current, start: t + k * 220 })));
  }

  const prog = (p: Pkt) => Math.max(0, Math.min(1, (now - p.start) / DUR));
  const xOf = (p: Pkt) => 4 + prog(p) * 92;
  const sent = pkts.filter((p) => prog(p) > 0).length;
  const pastTc = pkts.filter((p) => xOf(p) >= STAGES[2].x).length;
  const translations = sock ? (sent > 0 ? 1 : 0) : pastTc * 2;
  const natStage = sock ? STAGES[1].x : STAGES[2].x;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={sock ? "sock" : "pkt"}
          options={[{ value: "pkt", label: "Per-packet NAT (kube-proxy / tc)" }, { value: "sock", label: "Socket-level LB (Cilium)" }]}
          onChange={(v) => { setSock(v === "sock"); setPkts([]); }}
        />
        <Button variant="primary" onClick={burst}>▶ Send 8 packets</Button>
      </div>
      <div className="relative h-40 rounded-xl border border-line bg-bg/60">
        {/* track */}
        <div className="absolute top-[58%] right-[4%] left-[4%] h-px bg-line" />
        {STAGES.map((s, n) => (
          <div key={s.label} className="absolute top-3 -translate-x-1/2 text-center" style={{ left: `${s.x}%` }}>
            <div
              className={clsx(
                "mx-auto rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
                s.x === natStage ? "border-accent bg-accent/10 text-ink" : "border-line bg-panel-2 text-muted",
                n === 0 && "ml-0",
              )}
            >
              {s.label}
            </div>
            <div className="mt-0.5 hidden font-mono text-[9.5px] whitespace-nowrap text-faint sm:block">{s.sub}</div>
          </div>
        ))}
        <div className="absolute top-[58%] h-6 w-px -translate-y-1/2 bg-accent" style={{ left: `${natStage}%` }} />
        {pkts.map((p) => {
          if (prog(p) <= 0 || prog(p) >= 1) return null;
          const x = xOf(p);
          const translated = sock || x >= natStage;
          return (
            <div key={p.id} className="absolute top-[58%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%` }}>
              <div className={clsx("size-3 rounded-sm", translated ? "bg-ok" : "bg-accent-2")} />
            </div>
          );
        })}
        <div className="absolute right-3 bottom-2 left-3 flex flex-wrap justify-between gap-2 font-mono text-[10.5px]">
          <span><span className="text-accent-2">■</span> dst 10.96.120.15 (ClusterIP)</span>
          <span><span className="text-ok">■</span> dst 10.244.2.7 (backend)</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="packets sent" value={sent} />
        <Stat label="NAT translations" value={translations} tone={sock ? "good" : translations > 4 ? "warn" : "neutral"} />
        <Stat label="NAT where" value={sock ? "connect()" : "every pkt"} />
        <Stat label="conntrack for NAT" value={sock ? "not needed" : "required"} tone={sock ? "good" : "neutral"} />
      </div>
      <p className="text-sm leading-relaxed text-muted">
        {sock ? (
          <>
            A BPF program attached to the cgroup&apos;s <span className="font-mono">connect()</span> /{" "}
            <span className="font-mono">sendmsg()</span> hooks picks a backend and rewrites the socket&apos;s destination{" "}
            <i>once</i>. Every packet is born addressed to the pod; no per-packet DNAT, no reverse NAT on replies.{" "}
            <span className="font-mono">getpeername()</span> is translated back, so the app still believes it talks to the
            ClusterIP.
          </>
        ) : (
          <>
            Each packet leaves the socket addressed to the ClusterIP and gets DNAT&apos;ed on the way out; each reply needs a
            reverse translation, which requires connection-tracking state. Two rewrites per round trip, for the life of the
            connection.
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Flow = "clusterip" | "nodeport" | "policy";
const LAYERS = [
  { k: "sock", name: "Socket layer", hook: "cgroup BPF: connect4/6, sendmsg, recvmsg, getpeername", color: "var(--color-f4)" },
  { k: "nf", name: "netfilter / iptables", hook: "bypassed by Cilium (kube-proxy lives here)", color: "var(--color-faint)" },
  { k: "tc", name: "tc (traffic control)", hook: "bpf_lxc on each pod veth · bpf_host on eth0", color: "var(--color-f6)" },
  { k: "xdp", name: "XDP", hook: "in the NIC driver, before an skb is even allocated", color: "var(--color-ok)" },
  { k: "nic", name: "NIC", hook: "eth0 · hardware", color: "var(--color-muted)" },
] as const;

const FLOW_INFO: Record<Flow, { hl: string[]; text: string }> = {
  clusterip: {
    hl: ["sock"],
    text: "Pod → ClusterIP is resolved at the socket, before a packet exists (socket LB). With sidecar meshes like Istio you set socketLB.hostNamespaceOnly=true so pods see the ClusterIP; translation then falls back to tc.",
  },
  nodeport: {
    hl: ["xdp", "tc"],
    text: "External → NodePort / LoadBalancer: with XDP acceleration the service lookup and DNAT happen in the driver; packets can even be bounced straight back out the NIC (DSR / hairpin) without touching the stack. Without XDP-capable drivers, the same logic runs at tc on eth0.",
  },
  policy: {
    hl: ["tc"],
    text: "Pod ↔ pod: bpf_lxc on the pod's veth looks up the peer's security identity and the policy map, then either drops, forwards, or redirects to the Envoy proxy for L7 rules — all before netfilter.",
  },
};

export function HookStack() {
  const [flow, setFlow] = useState<Flow>("clusterip");
  const info = FLOW_INFO[flow];
  return (
    <div className="space-y-3">
      <Segmented
        value={flow}
        options={[{ value: "clusterip", label: "pod → ClusterIP" }, { value: "nodeport", label: "external → NodePort" }, { value: "policy", label: "pod → pod policy" }]}
        onChange={setFlow}
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ol className="space-y-1.5">
          {LAYERS.map((l) => {
            const on = info.hl.includes(l.k);
            return (
              <li
                key={l.k}
                className={clsx(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-all duration-300",
                  on ? "border-accent bg-accent/10" : "border-line bg-panel-2/40",
                  l.k === "nf" && "line-through decoration-faint opacity-60",
                )}
              >
                <span className="text-sm font-medium" style={{ color: on ? "var(--color-ink)" : l.color }}>{l.name}</span>
                <span className="text-right font-mono text-[10.5px] text-faint">{l.hook}</span>
              </li>
            );
          })}
        </ol>
        <p key={flow} className="animate-rise self-center text-sm leading-relaxed text-muted">{info.text}</p>
      </div>
    </div>
  );
}
