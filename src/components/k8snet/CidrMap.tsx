"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout, Segmented, Slider, Stat } from "../ui";

const COLORS = ["var(--color-f1)", "var(--color-f2)", "var(--color-f3)", "var(--color-f4)", "var(--color-f5)", "var(--color-f6)"];

function blockCidr(idx: number, mask: number) {
  // podSubnet 10.244.0.0/16 split into /mask blocks
  const size = 2 ** (32 - mask);
  const off = idx * size;
  return `10.244.${Math.floor(off / 256)}.${off % 256}/${mask}`;
}

export function CidrMap() {
  const [mask, setMask] = useState<"23" | "24" | "25" | "26">("24");
  const [nodes, setNodes] = useState(6);
  const [hover, setHover] = useState<number | null>(null);
  const m = Number(mask);
  const blocks = 2 ** (m - 16);
  const cols = blocks <= 256 ? 16 : 32;
  const rows = blocks / cols;
  const ipsPerNode = 2 ** (32 - m) - 2;
  const exhausted = nodes > blocks;
  const cell = 520 / cols;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Slider label="nodes" value={nodes} min={1} max={300} onChange={setNodes} />
        <label className="flex items-center gap-2 text-sm text-muted">
          node-cidr-mask-size
          <Segmented value={mask} options={["23", "24", "25", "26"] as const} onChange={setMask} />
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="rounded-xl border border-line bg-bg/60 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-faint">
            <span>podSubnets 10.244.0.0/16 → {blocks} × /{m}</span>
            <span className="text-muted">{hover != null ? `${blockCidr(hover, m)} → ${hover < nodes ? `node-${hover + 1}` : "free"}` : "hover a block"}</span>
          </div>
          <svg viewBox={`0 0 520 ${rows * cell}`} className="mx-auto h-auto w-full max-w-md" role="img" aria-label={`Pod CIDR split into ${blocks} blocks, ${Math.min(nodes, blocks)} allocated`}>
            {Array.from({ length: blocks }, (_, idx) => {
              const used = idx < nodes;
              const x = (idx % cols) * cell;
              const y = Math.floor(idx / cols) * cell;
              return (
                <rect
                  key={idx}
                  x={x + 1}
                  y={y + 1}
                  width={cell - 2}
                  height={cell - 2}
                  rx={Math.min(4, cell / 6)}
                  fill={used ? COLORS[idx % COLORS.length] : "var(--color-panel-2)"}
                  fillOpacity={used ? (hover === idx ? 1 : 0.7) : 1}
                  stroke={hover === idx ? "var(--color-ink)" : "transparent"}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: "fill 250ms, fill-opacity 250ms" }}
                />
              );
            })}
          </svg>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="pod IPs per node" value={ipsPerNode.toLocaleString()} tone={ipsPerNode < 110 ? "bad" : "good"} />
            <Stat label="max nodes" value={blocks.toLocaleString()} tone={exhausted ? "bad" : "neutral"} />
            <Stat label="allocated" value={`${Math.min(nodes, blocks)} / ${blocks}`} />
            <Stat label="service IPs (/12)" value="1,048,576" />
          </div>
          {exhausted ? (
            <Callout tone="bad" title={`${nodes - blocks} node(s) get no podCIDR`}>
              The node IPAM controller in kube-controller-manager runs out of /{m} blocks and emits{" "}
              <span className="font-mono">CIDRNotAvailable</span>. Those nodes stay NotReady because the CNI has no range to hand out.
              Pick a bigger podSubnet or a smaller per-node block <i>before</i> you bootstrap — it can&apos;t be changed in place.
            </Callout>
          ) : ipsPerNode < 110 ? (
            <Callout tone="warn" title="Fewer IPs than kubelet's default maxPods (110)">
              Pods beyond {ipsPerNode} on a node will fail sandbox creation with an IPAM exhaustion error. Lower{" "}
              <span className="font-mono">maxPods</span> or use a bigger block.
            </Callout>
          ) : (
            <Callout tone="info" title="Why per-node blocks?">
              Each node gets its own slice (<span className="font-mono">node.spec.podCIDR</span>), so it can assign pod IPs locally with no
              cluster-wide coordination, and every other node needs exactly one route per node, not per pod.
            </Callout>
          )}
          <div className="rounded-lg border border-line bg-panel-2/40 p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            <div className="text-faint"># serviceSubnets 10.96.0.0/12 (virtual — no node owns these)</div>
            <div>10.96.0.1 <span className="text-faint">→</span> <span className="text-ink">kubernetes</span> (API server)</div>
            <div>10.96.0.10 <span className="text-faint">→</span> <span className="text-ink">kube-dns</span> (CoreDNS)</div>
            <div>10.96.120.15 <span className="text-faint">→</span> <span className="text-ink">api</span> (allocated on create)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EndpointSlice → kube-proxy rules                                    */
/* ------------------------------------------------------------------ */

type PodState = "ready" | "notready" | "terminating";
const NEXT: Record<PodState, PodState> = { ready: "notready", notready: "terminating", terminating: "ready" };

export function EndpointSliceDemo() {
  const [pods, setPods] = useState<PodState[]>(["ready", "ready", "ready", "notready"]);
  const ready = pods.map((s, i) => ({ s, i })).filter((p) => p.s === "ready");
  const ip = (i: number) => `10.244.${(i % 3) + 1}.${20 + i}`;
  const node = (i: number) => `node-${(i % 3) + 1}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Deployment api, replicas:</span>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPods((p) => Array.from({ length: n }, (_, i) => p[i] ?? "ready"))}
            className={clsx("size-7 rounded-md border font-mono text-xs transition", pods.length === n ? "border-accent bg-accent/15 text-ink" : "border-line text-muted hover:text-ink")}
          >
            {n}
          </button>
        ))}
        <span className="ml-2 text-xs text-faint">click a pod to cycle Ready → NotReady → Terminating</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-1.5">
          <div className="text-[11px] tracking-wide text-faint uppercase">pods (label app=api)</div>
          {pods.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPods((p) => p.map((x, j) => (j === i ? NEXT[x] : x)))}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition animate-rise",
                s === "ready" && "border-ok/40 bg-ok/5",
                s === "notready" && "border-warn/40 bg-warn/5",
                s === "terminating" && "border-bad/40 bg-bad/5 opacity-70",
              )}
            >
              <span className="font-mono text-xs text-ink">api-{i + 1} <span className="text-faint">{ip(i)}</span></span>
              <span className={clsx("font-mono text-[10.5px]", s === "ready" ? "text-ok" : s === "notready" ? "text-warn" : "text-bad")}>{s}</span>
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
          <span className="text-faint">{"# EndpointSlice api-x7k2p (EndpointSlice controller)\n"}</span>
          {"addressType: IPv4\nports: [{port: 8080, protocol: TCP}]\nendpoints:\n"}
          {pods.map((s, i) => (
            <span key={i} className={clsx(s === "ready" ? "text-ink" : "text-faint")}>
              {`- addresses: ["${ip(i)}"]\n  nodeName: ${node(i)}\n  conditions:\n    ready: ${s === "ready"}\n    serving: ${s !== "notready"}\n    terminating: ${s === "terminating"}\n`}
            </span>
          ))}
        </pre>
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
          <span className="text-faint">{"# kube-proxy renders only ready endpoints\n"}</span>
          {ready.length === 0 ? (
            <span className="text-bad">{"-A KUBE-SERVICES -d 10.96.120.15/32 -p tcp --dport 80\n   -j REJECT  # no endpoints\n"}</span>
          ) : (
            ready.map((p, n) => {
              const left = ready.length - n;
              return (
                <span key={p.i} className="text-ink">
                  {left > 1
                    ? `-A KUBE-SVC-7RQX -m statistic --mode random\n   --probability ${(1 / left).toFixed(5)} -j SEP-api-${p.i + 1}\n`
                    : `-A KUBE-SVC-7RQX -j SEP-api-${p.i + 1}\n`}
                </span>
              );
            })
          )}
          {ready.length > 0 && (
            <span className="text-ok">{`\n# each ready pod: ${(100 / ready.length).toFixed(1)}% of new connections`}</span>
          )}
        </pre>
      </div>
    </div>
  );
}
