"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout } from "../ui";

type Req = "netpol" | "l7" | "bgp" | "kpr" | "enc" | "simple" | "windows" | "multinic" | "observe";

const REQS: { k: Req; label: string; hint: string }[] = [
  { k: "netpol", label: "NetworkPolicy", hint: "enforce the standard Kubernetes API" },
  { k: "l7", label: "L7 policy", hint: "allow GET /api but not POST /admin" },
  { k: "bgp", label: "BGP to ToR", hint: "advertise pod / LB IPs to your routers" },
  { k: "kpr", label: "kube-proxy replacement", hint: "drop iptables Service rules" },
  { k: "enc", label: "Encryption", hint: "node-to-node WireGuard / IPsec" },
  { k: "simple", label: "Simplicity", hint: "few moving parts, nothing to learn" },
  { k: "windows", label: "Windows nodes", hint: "mixed Linux / Windows cluster" },
  { k: "multinic", label: "Multiple NICs per pod", hint: "SR-IOV, storage or telco networks" },
  { k: "observe", label: "Flow observability", hint: "see who talks to whom, and verdicts" },
];

type Cni = { name: string; tag: string; s: Record<Req, 0 | 1 | 2>; note: string; color: string };

// 2 = first-class, 1 = partial / via add-on / limited, 0 = no
const CNIS: Cni[] = [
  {
    name: "Flannel",
    tag: "Talos default",
    color: "var(--color-f3)",
    s: { netpol: 0, l7: 0, bgp: 0, kpr: 0, enc: 1, simple: 2, windows: 2, multinic: 0, observe: 0 },
    note: "Just connectivity: VXLAN (or host-gw / WireGuard backend). Zero setup on Talos. No NetworkPolicy at all — policies are accepted by the API and silently ignored.",
  },
  {
    name: "Cilium",
    tag: "eBPF",
    color: "var(--color-f6)",
    s: { netpol: 2, l7: 2, bgp: 2, kpr: 2, enc: 2, simple: 1, windows: 0, multinic: 0, observe: 2 },
    note: "eBPF dataplane, full kube-proxy replacement, identity-based L3–L7 policy, Hubble, BGP control plane, LB IPAM, WireGuard/IPsec, Gateway API. Most capable; most to learn.",
  },
  {
    name: "Calico",
    tag: "BGP + policy",
    color: "var(--color-f5)",
    s: { netpol: 2, l7: 1, bgp: 2, kpr: 2, enc: 2, simple: 1, windows: 2, multinic: 0, observe: 1 },
    note: "iptables, nftables or eBPF dataplane; native BGP routing or IPIP/VXLAN; tiered GlobalNetworkPolicy; WireGuard; strong Windows support. Recent releases add flow logs + the Whisker UI.",
  },
  {
    name: "Antrea",
    tag: "OVS",
    color: "var(--color-f2)",
    s: { netpol: 2, l7: 1, bgp: 1, kpr: 2, enc: 2, simple: 1, windows: 2, multinic: 1, observe: 1 },
    note: "Open vSwitch dataplane, Geneve by default, AntreaProxy can replace kube-proxy, tiered ClusterNetworkPolicy, IPsec/WireGuard, first-class Windows.",
  },
  {
    name: "Kube-router",
    tag: "lean",
    color: "var(--color-f1)",
    s: { netpol: 2, l7: 0, bgp: 2, kpr: 2, enc: 0, simple: 2, windows: 0, multinic: 0, observe: 0 },
    note: "One binary: BGP pod routing (GoBGP), iptables/ipset NetworkPolicy, IPVS service proxy. Small and understandable; fewer features.",
  },
  {
    name: "Kube-OVN",
    tag: "SDN",
    color: "var(--color-f4)",
    s: { netpol: 2, l7: 0, bgp: 1, kpr: 1, enc: 1, simple: 0, windows: 1, multinic: 2, observe: 1 },
    note: "OVN/OVS virtual networking: subnets per namespace, static IPs, VPCs, underlay/VLAN mode, built for KubeVirt and multi-tenant setups.",
  },
];

export function CniChooser() {
  const [want, setWant] = useState<Set<Req>>(new Set(["netpol", "kpr"]));
  const toggle = (k: Req) =>
    setWant((w) => {
      const n = new Set(w);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const ranked = CNIS.map((c) => {
    const missing = [...want].filter((r) => c.s[r] === 0 && !(r === "multinic"));
    const score = [...want].reduce((a, r) => a + (r === "multinic" ? Math.max(c.s[r], 1) : c.s[r]), 0);
    return { c, missing, score, max: want.size * 2 };
  }).sort((a, b) => a.missing.length - b.missing.length || b.score - a.score);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {REQS.map((r) => (
          <label
            key={r.k}
            className={clsx(
              "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition",
              want.has(r.k) ? "border-accent/60 bg-accent/10" : "border-line bg-panel-2/40 hover:border-faint",
            )}
          >
            <input type="checkbox" checked={want.has(r.k)} onChange={() => toggle(r.k)} className="mt-0.5 accent-[var(--color-accent)]" />
            <span>
              <span className="block text-sm text-ink">{r.label}</span>
              <span className="block text-[11px] text-faint">{r.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <ol className="space-y-2">
        {ranked.map(({ c, missing, score, max }, idx) => {
          const pct = max ? (score / max) * 100 : 0;
          const ok = missing.length === 0;
          return (
            <li
              key={c.name}
              className={clsx("rounded-xl border p-3 transition-all", idx === 0 && ok ? "border-ok/50 bg-ok/5" : "border-line bg-panel-2/30", !ok && "opacity-70")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-5 font-mono text-xs text-faint">{idx + 1}.</span>
                <span className="font-semibold" style={{ color: c.color }}>{c.name}</span>
                <span className="font-mono text-[10.5px] text-faint">{c.tag}</span>
                <div className="ml-auto flex min-w-40 flex-1 items-center gap-2 sm:max-w-64">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: ok ? c.color : "var(--color-faint)" }} />
                  </div>
                  <span className="w-12 text-right font-mono text-[11px] text-muted tabular-nums">{score}/{max}</span>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                {[...want].map((r) => {
                  const v = r === "multinic" ? Math.max(c.s[r], 1) : c.s[r];
                  return (
                    <span
                      key={r}
                      className={clsx(
                        "rounded px-1.5 py-0.5 font-mono text-[10.5px]",
                        v === 2 && "bg-ok/10 text-ok",
                        v === 1 && "bg-warn/10 text-warn",
                        v === 0 && "bg-bad/10 text-bad line-through",
                      )}
                    >
                      {REQS.find((x) => x.k === r)!.label}
                      {r === "multinic" && c.s[r] < 2 ? " (+Multus)" : ""}
                    </span>
                  );
                })}
              </div>
              {idx < 3 && <p className="mt-1.5 pl-8 text-[12.5px] leading-relaxed text-muted">{c.note}</p>}
            </li>
          );
        })}
      </ol>
      {want.has("multinic") && (
        <Callout tone="info" title="Multiple NICs → Multus, on top of any of these">
          Multus is a meta-plugin: it calls your primary CNI for <span className="font-mono">eth0</span>, then extra plugins
          (macvlan, ipvlan, SR-IOV, bridge) for <span className="font-mono">net1, net2…</span> as requested by the{" "}
          <span className="font-mono">k8s.v1.cni.cncf.io/networks</span> annotation. Kube-OVN integrates with it natively.
        </Callout>
      )}
      <p className="text-[11px] text-faint">
        Scores are a rough guide: 2 = first-class, 1 = partial / add-on / limited, 0 = missing (struck through). A missing hard
        requirement sinks the option regardless of score.
      </p>
    </div>
  );
}
