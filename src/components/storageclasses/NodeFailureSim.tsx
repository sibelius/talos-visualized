"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Mono, Panel, Pill, Segmented, Stat } from "../ui";

type Chip = { node: number; role: string };

type Scenario = {
  id: string;
  label: string;
  color: string;
  blurb: string;
  /** data placement before the failure */
  data: Chip[];
  /** shared storage drawn under the nodes */
  external?: { label: string; sub: string };
  zones?: boolean;
  outcome: "moves" | "stuck";
  target?: number;
  /** final explanation for the outcome step */
  result: string;
  /** what "kubectl describe pod" would show for a stuck pod */
  event?: string;
  health?: string;
};

const NODES = ["talos-w1", "talos-w2", "talos-w3"];
const POD_NODE = 0;

const SCENARIOS: Scenario[] = [
  {
    id: "local-path",
    label: "local-path",
    color: "var(--color-f1)",
    blurb: "One directory on talos-w1. The PV carries nodeAffinity: kubernetes.io/hostname=talos-w1.",
    data: [{ node: 0, role: "dir" }],
    outcome: "stuck",
    result:
      "The replacement pod can't go anywhere: its PV is pinned to talos-w1 and the only copy of the data is on that disk. It stays Pending until the node comes back (or you delete the PVC and accept data loss / restore from backup).",
    event:
      "0/3 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 2 node(s) had volume node affinity conflict.",
    health: "data offline",
  },
  {
    id: "openebs-local",
    label: "OpenEBS Local",
    color: "var(--color-f6)",
    blurb: "An LVM logical volume on talos-w1. Same story as local-path — local means local.",
    data: [{ node: 0, role: "LV" }],
    outcome: "stuck",
    result:
      "Exactly like local-path: the volume's topology says talos-w1, so the scheduler refuses every other node. Local volumes are for apps that replicate themselves (Postgres operators, Kafka, Elasticsearch…).",
    event:
      "0/3 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 2 node(s) had volume node affinity conflict.",
    health: "data offline",
  },
  {
    id: "longhorn",
    label: "Longhorn",
    color: "var(--color-f2)",
    blurb: "numberOfReplicas: 3 — the engine runs next to the pod on w1, replicas on all three nodes.",
    data: [
      { node: 0, role: "engine+replica" },
      { node: 1, role: "replica" },
      { node: 2, role: "replica" },
    ],
    outcome: "moves",
    target: 1,
    result:
      "The pod starts on talos-w2. Longhorn starts a new engine there and attaches over iSCSI using the two healthy replicas. The volume is Degraded (2/3) until w1 returns or a new replica is rebuilt elsewhere.",
    health: "degraded 2/3",
  },
  {
    id: "rook-ceph",
    label: "Rook-Ceph RBD",
    color: "var(--color-accent)",
    blurb: "Pool size 3, failureDomain host: every object has a copy on each node's OSD.",
    data: [
      { node: 0, role: "OSD" },
      { node: 1, role: "OSD" },
      { node: 2, role: "OSD" },
    ],
    outcome: "moves",
    target: 2,
    result:
      "The pod starts on talos-w3, which maps the same RBD image. Ceph keeps serving from the two remaining OSDs (PGs active+undersized+degraded) and recovers when w1 or a new OSD appears.",
    health: "undersized 2/3",
  },
  {
    id: "ceph-external",
    label: "Ceph on Proxmox",
    color: "var(--color-warn)",
    blurb: "ceph-csi talks to the Ceph cluster run by the Proxmox hosts. No data lives on the Talos VMs.",
    data: [],
    external: { label: "Proxmox Ceph cluster", sub: "pool k8s-rbd · size 3 across PVE hosts" },
    outcome: "moves",
    target: 1,
    result:
      "The pod starts on talos-w2 and maps the same RBD image. Losing a Talos VM costs nothing storage-wise — the blast radius moved to the Proxmox/Ceph layer.",
    health: "healthy",
  },
  {
    id: "pve-local",
    label: "Proxmox CSI · local-lvm",
    color: "var(--color-accent-2)",
    blurb: "The PV is a virtual disk on pve-1's local-lvm. Its topology says zone=pve-1.",
    data: [{ node: 0, role: "vm-disk" }],
    zones: true,
    outcome: "stuck",
    result:
      "The disk physically sits on pve-1's local storage, so the PV is pinned to zone pve-1. If another Talos VM lived on pve-1 the pod could move there (the CSI plugin re-attaches the disk to that VM). With one VM per host it waits for the VM or host to come back.",
    event:
      "0/3 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 2 node(s) had volume node affinity conflict.",
    health: "data offline",
  },
  {
    id: "pve-shared",
    label: "Proxmox CSI · shared",
    color: "var(--color-accent-2)",
    blurb: "The PV is a virtual disk on storage every Proxmox host sees (e.g. Ceph RBD), so it is not tied to one zone.",
    data: [],
    zones: true,
    external: { label: "shared Proxmox storage", sub: "e.g. Ceph RBD — visible from pve-1/2/3" },
    outcome: "moves",
    target: 2,
    result:
      "Because the storage is shared across the Proxmox cluster, the plugin can detach the disk from the dead VM's config and hot-plug it into talos-w3 on pve-3. Check your plugin version's docs for how it labels shared-storage PVs.",
    health: "healthy",
  },
  {
    id: "nfs",
    label: "NFS",
    color: "var(--color-info)",
    blurb: "A sub-directory on an NFS export. Every node can mount it at the same time.",
    data: [],
    external: { label: "NAS · nfs://nas.lan/export/k8s", sub: "single box unless the NAS itself is HA" },
    outcome: "moves",
    target: 1,
    result:
      "The pod starts on talos-w2 and mounts the same export. NFS has no attach step, so there is no fight over who owns the volume — but the NAS is now your single point of failure.",
    health: "healthy",
  },
];

const STEP_MS = 1300;

export function NodeFailureSim() {
  const [id, setId] = useState(SCENARIOS[2].id);
  const [phase, setPhase] = useState(-1); // -1 healthy, 0..3 failure timeline, 4 node restored
  const [workload, setWorkload] = useState<"sts" | "deploy">("sts");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const s = SCENARIOS.find((x) => x.id === id)!;

  useEffect(() => () => clear(), []);
  function clear() {
    if (timer.current) clearTimeout(timer.current);
  }
  function reset(next?: string) {
    clear();
    setPhase(-1);
    if (next) setId(next);
  }
  function kill() {
    clear();
    setPhase(0);
    let p = 0;
    const tick = () => {
      p += 1;
      setPhase(p);
      if (p < 3) timer.current = setTimeout(tick, STEP_MS);
    };
    timer.current = setTimeout(tick, STEP_MS);
  }

  const dead = phase >= 0 && phase < 4;
  const done = phase === 3;
  const podNode = phase === 4 ? POD_NODE : phase >= 3 && s.outcome === "moves" ? s.target! : POD_NODE;
  const pending = phase >= 3 && phase < 4 && s.outcome === "stuck";

  const steps = [
    { t: "t+0s", text: "talos-w1 loses power. Its kubelet stops renewing its Lease." },
    {
      t: "t+~40s",
      text: "node-lifecycle controller marks the node Unknown/NotReady and taints it node.kubernetes.io/unreachable:NoExecute.",
    },
    {
      t: "t+~5m",
      text:
        workload === "sts"
          ? "Default 300s toleration expires → eviction. But a StatefulSet pod sits in Terminating: the API can't prove it stopped, and the RWO volume is still attached to w1. Either the node returns, or you add the node.kubernetes.io/out-of-service taint (non-graceful node shutdown) to force-delete pods and detach volumes."
          : "Default 300s toleration expires → eviction; the ReplicaSet creates a replacement pod immediately. Its RWO volume, though, is still attached to w1 — the new pod waits in ContainerCreating until the volume is released (node returns, out-of-service taint, or the driver's own timeout).",
    },
    { t: "outcome", text: s.result },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SCENARIOS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => reset(x.id)}
            className={clsx(
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
              x.id === id ? "border-transparent text-black" : "border-line bg-panel-2 text-muted hover:text-ink",
            )}
            style={x.id === id ? { background: x.color } : undefined}
            aria-pressed={x.id === id}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title={`Cluster · ${s.label}`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={workload}
                onChange={(v) => {
                  setWorkload(v);
                  reset();
                }}
                options={[
                  { value: "sts", label: "StatefulSet" },
                  { value: "deploy", label: "Deployment" },
                ]}
              />
              {phase === -1 && (
                <Button variant="danger" onClick={kill}>
                  ⚡ Kill talos-w1
                </Button>
              )}
              {done && s.outcome === "stuck" && <Button onClick={() => setPhase(4)}>Power w1 back on</Button>}
              {phase >= 3 && <Button variant="ghost" onClick={() => reset()}>Reset</Button>}
            </div>
          }
        >
          <p className="mb-4 text-sm text-muted">{s.blurb}</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {NODES.map((n, i) => {
              const isDead = dead && i === POD_NODE;
              const chips = s.data.filter((c) => c.node === i);
              const hasPod = podNode === i && !pending;
              const ghost = isDead && phase < 3;
              return (
                <div
                  key={n}
                  className={clsx(
                    "relative min-h-40 rounded-xl border p-2 transition-all duration-500 sm:p-3",
                    isDead ? "border-bad/60 bg-bad/5" : "border-line bg-panel-2/60",
                  )}
                  aria-label={`${n}${isDead ? " (down)" : ""}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={clsx("font-mono text-[11px] sm:text-xs", isDead ? "text-bad line-through" : "text-ink")}>{n}</span>
                    <span
                      className={clsx("size-2 shrink-0 rounded-full", isDead ? "bg-bad" : "bg-ok", isDead && "animate-pulse-soft")}
                      aria-hidden
                    />
                  </div>
                  {s.zones && <div className="mt-0.5 font-mono text-[10px] text-faint">VM on pve-{i + 1} · zone pve-{i + 1}</div>}
                  <div className="mt-1 font-mono text-[10px] text-faint">
                    {isDead ? (phase >= 1 ? "NotReady · unreachable" : "no heartbeat…") : "Ready"}
                  </div>

                  <div className="mt-3 min-h-9">
                    {(hasPod || ghost) && (
                      <div
                        key={`${i}-${phase >= 3}`}
                        className={clsx(
                          "animate-rise rounded-md border px-2 py-1 font-mono text-[11px] transition",
                          ghost ? "border-dashed border-bad/50 text-bad/80" : "border-ok/50 bg-ok/10 text-ok",
                        )}
                      >
                        {workload === "sts" ? "db-0" : "db-7c9f"}
                        <div className="text-[10px] opacity-80">
                          {ghost ? (phase >= 2 ? (workload === "sts" ? "Terminating" : "Unknown") : "Unknown") : "Running"}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {chips.map((c, k) => (
                      <span
                        key={k}
                        className={clsx(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-all duration-500",
                          isDead ? "border-line text-faint opacity-50" : "text-ink",
                        )}
                        style={isDead ? undefined : { borderColor: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}
                      >
                        ▤ {c.role}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {s.external && (
            <div
              className="mt-3 rounded-xl border px-3 py-2 text-center"
              style={{ borderColor: s.color, background: `color-mix(in srgb, ${s.color} 8%, transparent)` }}
            >
              <div className="font-mono text-xs text-ink">▤ {s.external.label}</div>
              <div className="text-[11px] text-muted">{s.external.sub}</div>
            </div>
          )}

          {pending && (
            <div className="mt-3 animate-rise rounded-lg border border-dashed border-warn/60 bg-warn/5 p-3">
              <div className="mb-1 font-mono text-xs text-warn">{workload === "sts" ? "db-0" : "db-7c9f"} · Pending</div>
              <Mono className="whitespace-pre-wrap">Warning  FailedScheduling  {s.event}</Mono>
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="pod" value={phase === -1 || phase === 4 ? "Running" : pending ? "Pending" : done ? "Running" : "…"} tone={pending ? "bad" : done || phase === 4 || phase === -1 ? "good" : "warn"} />
            <Stat label="pod on" value={pending ? "—" : NODES[podNode].replace("talos-", "")} />
            <Stat
              label="data"
              value={phase === -1 || phase === 4 ? "healthy" : done ? s.health : "…"}
              tone={phase === -1 || phase === 4 ? "good" : done ? (s.outcome === "stuck" ? "bad" : s.health === "healthy" ? "good" : "warn") : "neutral"}
            />
          </div>
        </Panel>

        <Panel title="What Kubernetes does">
          {phase === -1 && (
            <p className="text-sm text-muted">
              The pod runs on <span className="font-mono text-ink">talos-w1</span>. Pull the plug and watch the control plane react. Toggle
              StatefulSet / Deployment — they behave differently while the node is merely <em>unreachable</em>.
            </p>
          )}
          {phase >= 0 && (
            <ol className="space-y-3">
              {steps.map((st, i) =>
                i <= Math.min(phase, 3) ? (
                  <li key={i} className="animate-rise border-l-2 pl-3 text-sm leading-relaxed text-muted" style={{ borderColor: i === 3 ? (s.outcome === "stuck" ? "var(--color-bad)" : "var(--color-ok)") : "var(--color-line)" }}>
                    <span className="mb-0.5 block font-mono text-[11px] text-faint">{st.t}</span>
                    {st.text}
                  </li>
                ) : null,
              )}
              {phase === 4 && (
                <li className="animate-rise border-l-2 border-ok pl-3 text-sm text-muted">
                  <span className="mb-0.5 block font-mono text-[11px] text-faint">node back</span>
                  talos-w1 rejoins, the taint is removed and the Pending pod finally schedules onto it — the data was never lost, only
                  unavailable. That downtime is the price of local storage.
                </li>
              )}
            </ol>
          )}
          {done && (
            <div className="mt-4">
              <Pill color={s.outcome === "stuck" ? "var(--color-bad)" : "var(--color-ok)"}>
                {s.outcome === "stuck" ? "pod stuck — data pinned to the dead node" : "pod moved — data followed"}
              </Pill>
            </div>
          )}
        </Panel>
      </div>

      <Callout tone="warn" title="Replication doesn't make failover instant">
        Even with Longhorn or Ceph, Kubernetes deliberately refuses to run a second copy of an RWO/StatefulSet pod while the old node
        might still be writing. Plan for the ~5 minute eviction window, and learn the{" "}
        <span className="font-mono text-ink">node.kubernetes.io/out-of-service</span> taint for when you <em>know</em> a node is gone.
      </Callout>
    </div>
  );
}
