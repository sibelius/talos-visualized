"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Mono, Pill } from "../ui";
import { emit, merge, type Y } from "./yaml";

const V = "v1.11.3";
const K = "v1.34.1";

const BASE: Y = {
  version: "v1alpha1",
  debug: false,
  persist: true,
  machine: {
    type: "controlplane",
    token: "7k2x9f.q8wzr4h1m0c6ab3t",
    ca: { crt: "LS0tLS1CRUdJTi…", key: "LS0tLS1CRUdJTi…" },
    certSANs: [],
    kubelet: { image: `ghcr.io/siderolabs/kubelet:${K}`, defaultRuntimeSeccompProfileEnabled: true, disableManifestsDirectory: true },
    network: {},
    install: { disk: "/dev/sda", image: `ghcr.io/siderolabs/installer:${V}`, wipe: false },
    features: {
      rbac: true,
      stableHostname: true,
      apidCheckExtKeyUsage: true,
      diskQuotaSupport: true,
      kubePrism: { enabled: true, port: 7445 },
      hostDNS: { enabled: true, forwardKubeDNSToHost: true },
    },
  },
  cluster: {
    id: "Qm9vdHN0cmFwIElE…",
    secret: "c2VjcmV0…",
    controlPlane: { endpoint: "https://10.0.0.5:6443" },
    clusterName: "homelab",
    network: { dnsDomain: "cluster.local", podSubnets: ["10.244.0.0/16"], serviceSubnets: ["10.96.0.0/12"] },
    token: "abc123.0123456789abcdef",
    secretboxEncryptionSecret: "z8x…",
    ca: { crt: "LS0tLS1CRUdJTi…", key: "LS0tLS1CRUdJTi…" },
    apiServer: { image: `registry.k8s.io/kube-apiserver:${K}`, certSANs: ["10.0.0.5"] },
    controllerManager: { image: `registry.k8s.io/kube-controller-manager:${K}` },
    proxy: { image: `registry.k8s.io/kube-proxy:${K}` },
    scheduler: { image: `registry.k8s.io/kube-scheduler:${K}` },
    discovery: { enabled: true, registries: { kubernetes: { disabled: true }, service: {} } },
    etcd: { ca: { crt: "LS0tLS1CRUdJTi…", key: "LS0tLS1CRUdJTi…" } },
  },
};

type Patch = { id: string; file: string; label: string; color: string; why: string; body: Y };

const PATCHES: Patch[] = [
  {
    id: "disk",
    file: "install.yaml",
    label: "install disk + factory image",
    color: "var(--color-f1)",
    why: "Scalars are replaced. The installer image comes from Image Factory, so it carries your system extensions (here: qemu-guest-agent + iscsi-tools).",
    body: { machine: { install: { disk: "/dev/vda", image: `factory.talos.dev/installer/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515:${V}` } } },
  },
  {
    id: "net",
    file: "cp1-network.yaml",
    label: "static IP + VIP",
    color: "var(--color-f2)",
    why: "Per-node patch. The VIP is a shared Layer-2 address that one healthy control plane holds; Kubernetes clients use it as the API endpoint.",
    body: {
      machine: {
        network: {
          hostname: "cp-1",
          nameservers: ["10.0.0.1"],
          interfaces: [
            {
              deviceSelector: { physical: true },
              addresses: ["10.0.0.10/24"],
              routes: [{ network: "0.0.0.0/0", gateway: "10.0.0.1" }],
              vip: { ip: "10.0.0.5" },
            },
          ],
        },
      },
    },
  },
  {
    id: "cilium",
    file: "cilium.yaml",
    label: "no CNI + no kube-proxy (Cilium)",
    color: "var(--color-f4)",
    why: "Talos deploys Flannel and kube-proxy by default. Setting cni.name: none and proxy.disabled leaves the slot free for Cilium with kube-proxy replacement. Nodes stay NotReady until you install it.",
    body: { cluster: { network: { cni: { name: "none" } }, proxy: { disabled: true } } },
  },
  {
    id: "sans",
    file: "sans.yaml",
    label: "extra cert SANs",
    color: "var(--color-f3)",
    why: "Lists are appended, not replaced: the generated SAN stays and yours is added. (Use $patch: delete to remove a key.)",
    body: { machine: { certSANs: ["talos.home.example"] }, cluster: { apiServer: { certSANs: ["k8s.home.example"] } } },
  },
  {
    id: "labels",
    file: "node.yaml",
    label: "labels + kubelet args",
    color: "var(--color-f5)",
    why: "nodeLabels are applied to the Node object by Talos; kubelet extraArgs become command-line flags. Both can be changed live.",
    body: {
      machine: {
        nodeLabels: { "topology.kubernetes.io/zone": "rack-1" },
        kubelet: { extraArgs: { "rotate-server-certificates": "true" } },
      },
    },
  },
  {
    id: "sched",
    file: "small-cluster.yaml",
    label: "schedule on control planes",
    color: "var(--color-f6)",
    why: "For 3-node clusters: removes the control-plane NoSchedule taint so workloads can run there too.",
    body: { cluster: { allowSchedulingOnControlPlanes: true } },
  },
];

export function PatchMerge() {
  const [on, setOn] = useState<string[]>(["net", "cilium"]);
  const [focus, setFocus] = useState<string>("cilium");

  const { lines, owner, changed } = useMemo(() => {
    let cur = BASE;
    const owner = new Map<string, Patch>();
    let prevIds = new Set(emit(cur).map((l) => l.id));
    for (const p of PATCHES) {
      if (!on.includes(p.id)) continue;
      cur = merge(cur, p.body);
      const ls = emit(cur);
      for (const l of ls) if (!prevIds.has(l.id)) owner.set(l.id, p);
      prevIds = new Set(ls.map((l) => l.id));
    }
    const lines = emit(cur);
    return { lines, owner, changed: lines.filter((l) => owner.has(l.id)).length };
  }, [on]);

  const fp = PATCHES.find((p) => p.id === focus)!;
  const active = PATCHES.filter((p) => on.includes(p.id));
  const cmd = `talosctl gen config homelab https://10.0.0.5:6443 \\\n  --with-secrets secrets.yaml${active.map((p) => ` \\\n  --config-patch @patches/${p.file}`).join("")}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        <div className="text-[11px] tracking-wide text-faint uppercase">patches (applied in order)</div>
        <ul className="space-y-1.5">
          {PATCHES.map((p) => {
            const checked = on.includes(p.id);
            return (
              <li key={p.id}>
                <label
                  className={clsx(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-sm transition",
                    focus === p.id ? "border-faint bg-panel-2" : "border-line hover:border-faint",
                  )}
                  onMouseEnter={() => setFocus(p.id)}
                  onFocus={() => setFocus(p.id)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setFocus(p.id);
                      setOn((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)));
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color, opacity: checked ? 1 : 0.3 }} />
                  <span className={checked ? "text-ink" : "text-muted"}>{p.label}</span>
                  <span className="ml-auto hidden font-mono text-[10.5px] text-faint sm:inline">{p.file}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="rounded-lg border border-line bg-panel-2/40 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: fp.color }} />
            <span className="font-mono text-[11px] text-ink">patches/{fp.file}</span>
          </div>
          <Mono className="max-h-56 bg-bg/60">{emit(fp.body).map((l) => l.text).join("\n")}</Mono>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{fp.why}</p>
        </div>
        <Mono className="whitespace-pre">{cmd}</Mono>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] tracking-wide text-faint uppercase">controlplane.yaml (merged)</span>
          <Pill color={changed ? "var(--color-accent)" : undefined}>{changed} lines from patches</Pill>
        </div>
        <pre className="max-h-[640px] overflow-auto rounded-lg border border-line bg-bg py-2 font-mono text-[11.5px] leading-[1.55]">
          {lines.map((l) => {
            const p = owner.get(l.id);
            return (
              <div
                key={l.id + l.text}
                className={clsx("px-3 transition-colors", p ? "text-ink" : "text-muted")}
                style={
                  p
                    ? { background: `color-mix(in srgb, ${p.color} 13%, transparent)`, boxShadow: `inset 3px 0 0 ${p.color}` }
                    : undefined
                }
              >
                {colorize(l.text)}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function colorize(text: string) {
  const m = text.match(/^(\s*(?:- )?)([^:]+:)(.*)$/);
  if (!m || text.trimStart().startsWith("- ") && !m[2].match(/^[\w./-]+:$/)) return text;
  return (
    <>
      {m[1]}
      <span className="text-info">{m[2]}</span>
      <span>{m[3]}</span>
    </>
  );
}
