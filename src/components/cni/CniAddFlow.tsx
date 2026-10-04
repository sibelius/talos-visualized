"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Segmented } from "../ui";

type Actor = "kubelet" | "containerd" | "plugin" | "ipam";
type Vis = { netns: boolean; veth: boolean; moved: boolean; ip: boolean; route: boolean; done: boolean };
type Step = { actor: Actor; title: string; body: string; payloadTitle: string; payload: string; vis: Vis };

const V = (p: Partial<Vis>): Vis => ({ netns: false, veth: false, moved: false, ip: false, route: false, done: false, ...p });

const ADD: Step[] = [
  {
    actor: "kubelet",
    title: "kubelet asks the runtime for a pod sandbox",
    body: "The scheduler bound the pod to this node. kubelet calls the CRI RunPodSandbox RPC on containerd. Kubernetes itself never touches interfaces or IPs.",
    payloadTitle: "CRI gRPC",
    payload: `RunPodSandbox {
  config: { metadata: { name: "web-7d9f", namespace: "default" },
            linux: { ... } }
}`,
    vis: V({}),
  },
  {
    actor: "containerd",
    title: "containerd creates an empty network namespace",
    body: "It starts the pause container in a brand-new netns. Inside there is only a loopback interface: no eth0, no IP, no routes.",
    payloadTitle: "$ ip netns",
    payload: `cni-6c1e0b9a-41f2-…   ← new, only 'lo' inside
cni-0d93a1f7-…
cni-a2be55c0-…`,
    vis: V({ netns: true }),
  },
  {
    actor: "containerd",
    title: "…reads the first config in /etc/cni/net.d",
    body: "The lexically first file wins. The CNI DaemonSet (Flannel, Cilium, Calico…) drops this file when it starts — until it exists the node reports NetworkReady=false and pods stay Pending/ContainerCreating.",
    payloadTitle: "/etc/cni/net.d/10-flannel.conflist",
    payload: `{
  "name": "cbr0",
  "cniVersion": "1.0.0",
  "plugins": [
    { "type": "flannel",
      "delegate": { "hairpinMode": true, "isDefaultGateway": true } },
    { "type": "portmap", "capabilities": { "portMappings": true } }
  ]
}`,
    vis: V({ netns: true }),
  },
  {
    actor: "plugin",
    title: "exec /opt/cni/bin/flannel with CNI_COMMAND=ADD",
    body: "A CNI plugin is just a binary. Parameters arrive as environment variables, the network config on stdin, and the result goes back on stdout as JSON. Flannel reads its node's lease and delegates to the standard bridge + host-local plugins.",
    payloadTitle: "env + stdin",
    payload: `CNI_COMMAND=ADD
CNI_CONTAINERID=6c1e0b9a41f2…
CNI_NETNS=/var/run/netns/cni-6c1e0b9a-41f2-…
CNI_IFNAME=eth0
CNI_PATH=/opt/cni/bin

# /run/flannel/subnet.env
FLANNEL_NETWORK=10.244.0.0/16
FLANNEL_SUBNET=10.244.1.1/24
FLANNEL_MTU=1450`,
    vis: V({ netns: true }),
  },
  {
    actor: "plugin",
    title: "bridge plugin: create a veth pair",
    body: "Two linked virtual interfaces are created in the host namespace. The host end is attached to the cni0 bridge (created on first use) and both get MTU 1450 to leave room for VXLAN headers.",
    payloadTitle: "equivalent ip commands",
    payload: `ip link add veth6c1e type veth peer name eth0-tmp
ip link set veth6c1e master cni0 mtu 1450 up`,
    vis: V({ netns: true, veth: true }),
  },
  {
    actor: "plugin",
    title: "…move one end into the pod and call it eth0",
    body: "The peer end is moved into the pod's netns and renamed to CNI_IFNAME. The pod now has a cable to the host.",
    payloadTitle: "equivalent ip commands",
    payload: `ip link set eth0-tmp netns cni-6c1e0b9a-41f2-…
ip -n cni-6c1e… link set eth0-tmp name eth0 mtu 1450 up`,
    vis: V({ netns: true, veth: true, moved: true }),
  },
  {
    actor: "ipam",
    title: "IPAM: host-local hands out the next free IP",
    body: "IP address management is a separate plugin. host-local allocates from this node's podCIDR and records the lease as a file, so the IP is never handed out twice — and must be released on DEL.",
    payloadTitle: "/var/lib/cni/networks/cbr0/",
    payload: `10.244.1.2   → 0d93a1f7…
10.244.1.3   → a2be55c0…
10.244.1.5   → 6c1e0b9a…   ← new
last_reserved_ip.0`,
    vis: V({ netns: true, veth: true, moved: true, ip: true }),
  },
  {
    actor: "plugin",
    title: "configure the address and routes inside the pod",
    body: "The plugin enters the netns, assigns 10.244.1.5/24 to eth0 and adds a default route via the bridge IP 10.244.1.1. Cross-node routes live on the host (flannel.1), not in the pod.",
    payloadTitle: "inside the pod netns",
    payload: `ip addr add 10.244.1.5/24 dev eth0
ip route add default via 10.244.1.1 dev eth0`,
    vis: V({ netns: true, veth: true, moved: true, ip: true, route: true }),
  },
  {
    actor: "containerd",
    title: "Result JSON goes back up; kubelet reports the pod IP",
    body: "The chained portmap plugin runs (hostPort support), the result is returned to containerd, and kubelet writes status.podIP. Only now do app containers start.",
    payloadTitle: "stdout (CNI result)",
    payload: `{
  "cniVersion": "1.0.0",
  "interfaces": [{ "name": "eth0", "sandbox": "/var/run/netns/cni-6c1e…" }],
  "ips": [{ "address": "10.244.1.5/24", "gateway": "10.244.1.1", "interface": 0 }],
  "routes": [{ "dst": "0.0.0.0/0" }]
}`,
    vis: V({ netns: true, veth: true, moved: true, ip: true, route: true, done: true }),
  },
];

const DEL: Step[] = [
  {
    actor: "kubelet",
    title: "Pod deleted → StopPodSandbox",
    body: "Containers have exited; kubelet asks the runtime to tear down the sandbox.",
    payloadTitle: "CRI gRPC",
    payload: "StopPodSandbox { pod_sandbox_id: \"6c1e0b9a41f2…\" }",
    vis: V({ netns: true, veth: true, moved: true, ip: true, route: true, done: true }),
  },
  {
    actor: "plugin",
    title: "exec the same plugin chain with CNI_COMMAND=DEL",
    body: "Plugins run in reverse order. DEL must be idempotent: the runtime may call it more than once, or for a sandbox that half-failed.",
    payloadTitle: "env",
    payload: "CNI_COMMAND=DEL\nCNI_CONTAINERID=6c1e0b9a41f2…\nCNI_NETNS=/var/run/netns/cni-6c1e…\nCNI_IFNAME=eth0",
    vis: V({ netns: true, veth: true, moved: true, ip: true, route: true }),
  },
  {
    actor: "ipam",
    title: "IPAM releases 10.244.1.5",
    body: "The lease file is removed so the address can be reused. A missed DEL here is the classic cause of 'no IP addresses available in range' on long-lived nodes; CNI 1.1 added a GC verb to clean up such leaks.",
    payloadTitle: "/var/lib/cni/networks/cbr0/",
    payload: "10.244.1.2   → 0d93a1f7…\n10.244.1.3   → a2be55c0…\n(10.244.1.5 released)",
    vis: V({ netns: true, veth: true, moved: true }),
  },
  {
    actor: "containerd",
    title: "netns destroyed — veth goes with it",
    body: "Deleting a veth end deletes its peer, so removing the namespace cleans up both sides of the cable.",
    payloadTitle: "$ ip netns",
    payload: "cni-0d93a1f7-…\ncni-a2be55c0-…",
    vis: V({}),
  },
];

const ACTORS: { k: Actor; label: string; sub: string }[] = [
  { k: "kubelet", label: "kubelet", sub: "CRI client" },
  { k: "containerd", label: "containerd", sub: "runtime" },
  { k: "plugin", label: "CNI plugin", sub: "/opt/cni/bin/*" },
  { k: "ipam", label: "IPAM", sub: "host-local" },
];

export function CniAddFlow() {
  const [cmd, setCmd] = useState<"ADD" | "DEL">("ADD");
  const steps = cmd === "ADD" ? ADD : DEL;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = steps[Math.min(i, steps.length - 1)];
  const v = step.vis;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (i >= steps.length - 1) setPlaying(false);
      else setI((x) => x + 1);
    }, 2600);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);

  const T = "all 500ms ease";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={cmd}
          options={[{ value: "ADD", label: "CNI ADD (pod start)" }, { value: "DEL", label: "CNI DEL (pod delete)" }]}
          onChange={(c) => { setCmd(c); setI(0); setPlaying(false); }}
        />
        <div className="flex gap-1.5">
          <Button onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} disabled={i === 0}>Prev</Button>
          <Button onClick={() => { setPlaying(false); setI((x) => Math.min(steps.length - 1, x + 1)); }} disabled={i >= steps.length - 1}>Next</Button>
          <Button variant="primary" onClick={() => { if (i >= steps.length - 1) setI(0); setPlaying((p) => !p); }}>{playing ? "Pause" : "▶ Play"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTORS.map((a, n) => (
          <div
            key={a.k}
            className={clsx(
              "relative rounded-lg border px-3 py-2 transition",
              step.actor === a.k ? "border-accent bg-accent/10 animate-flash" : "border-line bg-panel-2/50",
            )}
          >
            <div className="text-sm font-medium">{a.label}</div>
            <div className="font-mono text-[10.5px] text-faint">{a.sub}</div>
            {n < ACTORS.length - 1 && <span className="absolute top-1/2 -right-2 hidden -translate-y-1/2 text-faint sm:block">›</span>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-line bg-bg/60 p-2">
          <svg viewBox="0 0 480 300" className="h-auto w-full" role="img" aria-label="Node network namespaces during CNI execution">
            <rect x={8} y={8} width={464} height={284} rx={14} fill="var(--color-panel)" stroke="var(--color-line)" />
            <text x={22} y={28} fontSize={11} fill="var(--color-faint)" fontFamily="var(--font-mono)">host network namespace · node A</text>

            {/* existing pods */}
            {[0, 1].map((n) => (
              <g key={n}>
                <rect x={30 + n * 130} y={48} width={110} height={74} rx={10} fill="var(--color-panel-2)" stroke="var(--color-line)" />
                <text x={85 + n * 130} y={68} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">pod netns</text>
                <text x={85 + n * 130} y={102} textAnchor="middle" fontSize={10} fill="var(--color-f1)" fontFamily="var(--font-mono)">eth0 10.244.1.{n + 2}</text>
                <line x1={85 + n * 130} y1={122} x2={85 + n * 130} y2={208} stroke="var(--color-line)" strokeWidth={2} />
              </g>
            ))}

            {/* new pod netns */}
            <g style={{ opacity: v.netns ? 1 : 0, transition: T }}>
              <rect
                x={300} y={48} width={150} height={100} rx={10}
                fill={v.done ? "color-mix(in srgb, var(--color-ok) 10%, var(--color-panel-2))" : "var(--color-panel-2)"}
                stroke={v.done ? "var(--color-ok)" : "var(--color-accent)"} strokeDasharray={v.done ? undefined : "5 4"}
                style={{ transition: T }}
              />
              <text x={375} y={66} textAnchor="middle" fontSize={10} fill="var(--color-ink)" fontFamily="var(--font-mono)">netns cni-6c1e…</text>
              <text x={318} y={84} fontSize={9.5} fill="var(--color-faint)" fontFamily="var(--font-mono)">lo 127.0.0.1</text>
              <g style={{ opacity: v.moved ? 1 : 0, transition: T }}>
                <rect x={330} y={118} width={90} height={22} rx={6} fill="var(--color-bg)" stroke="var(--color-f1)" />
                <text x={375} y={133} textAnchor="middle" fontSize={10} fill="var(--color-f1)" fontFamily="var(--font-mono)">
                  eth0
                </text>
              </g>
              <text x={375} y={104} textAnchor="middle" fontSize={10.5} fill="var(--color-accent)" fontFamily="var(--font-mono)" style={{ opacity: v.ip ? 1 : 0, transition: T }}>
                10.244.1.5/24
              </text>
            </g>
            <text x={375} y={164} textAnchor="middle" fontSize={9} fill="var(--color-muted)" fontFamily="var(--font-mono)" style={{ opacity: v.route ? 1 : 0, transition: T }}>
              default via 10.244.1.1
            </text>

            {/* veth: host end appears first, then the peer goes up into the netns */}
            <g style={{ opacity: v.veth ? 1 : 0, transition: T }}>
              <line
                x1={375} y1={v.moved ? 140 : 186} x2={375} y2={208}
                stroke="var(--color-accent)" strokeWidth={2.5} strokeDasharray="6 6" className="animate-dash"
                style={{ transition: T }}
              />
              <rect x={345} y={176} width={60} height={18} rx={9} fill="var(--color-panel-2)" stroke="var(--color-accent)" />
              <text x={375} y={189} textAnchor="middle" fontSize={9.5} fill="var(--color-ink)" fontFamily="var(--font-mono)">veth6c1e</text>
            </g>

            {/* bridge */}
            <rect x={30} y={208} width={420} height={26} rx={7} fill="var(--color-panel-2)" stroke="var(--color-f6)" />
            <text x={240} y={225} textAnchor="middle" fontSize={10.5} fill="var(--color-f6)" fontFamily="var(--font-mono)">cni0 bridge 10.244.1.1/24</text>
            <line x1={240} y1={234} x2={240} y2={256} stroke="var(--color-line)" strokeWidth={2} />
            <rect x={150} y={256} width={180} height={24} rx={7} fill="var(--color-panel-2)" stroke="var(--color-line)" />
            <text x={240} y={272} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">flannel.1 → eth0 (to other nodes)</text>
          </svg>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex gap-1" aria-hidden>
            {steps.map((_, s) => (
              <button key={s} type="button" onClick={() => setI(s)} className={clsx("h-1 flex-1 rounded-full transition", s <= i ? "bg-accent" : "bg-line")} aria-label={`step ${s + 1}`} />
            ))}
          </div>
          <div key={`${cmd}-${i}`} className="animate-rise" aria-live="polite">
            <div className="font-mono text-[11px] text-faint">
              {cmd} · step {i + 1}/{steps.length}
            </div>
            <h3 className="mt-0.5 text-[15px] font-semibold">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-bg">
            <div className="border-b border-line px-3 py-1 font-mono text-[10.5px] text-faint">{step.payloadTitle}</div>
            <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-muted">{step.payload}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
