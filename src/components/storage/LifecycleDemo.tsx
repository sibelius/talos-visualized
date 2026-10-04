"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented, Toggle } from "../ui";

type Mode = "Immediate" | "WaitForFirstConsumer";
type Actor = "user" | "api" | "scheduler" | "kcm" | "provisioner" | "attacher" | "controller" | "kubelet" | "nodeplugin" | "container";
type Zone = "zone-a" | "zone-b" | "zone-c";

const NODES: { name: string; zone: Zone }[] = [
  { name: "worker-1", zone: "zone-a" },
  { name: "worker-2", zone: "zone-b" },
  { name: "worker-3", zone: "zone-c" },
];

type State = {
  pvc: "—" | "Pending" | "Bound";
  pvcNote?: string;
  pv: null | "Bound";
  diskZone: Zone | null;
  va: null | "attached=false" | "attached=true";
  pod: "—" | "Pending" | "Scheduled" | "Running" | "Unschedulable";
  podNode: string | null;
  staged: boolean;
  published: boolean;
};

type Step = {
  actors: Actor[];
  title: string;
  detail: string;
  rpc?: string;
  state: State;
  bad?: boolean;
};

const empty: State = { pvc: "—", pv: null, diskZone: null, va: null, pod: "—", podNode: null, staged: false, published: false };

function buildSteps(mode: Mode, pinZoneC: boolean): Step[] {
  const s: Step[] = [];
  const push = (actors: Actor[], title: string, detail: string, patch: Partial<State>, rpc?: string, bad?: boolean) => {
    const prev = s.length ? s[s.length - 1].state : empty;
    s.push({ actors, title, detail, rpc, bad, state: { ...prev, ...patch } });
  };

  push(
    ["user", "api"],
    "kubectl apply -f pvc.yaml",
    "The PVC is just a request: \"10Gi, ReadWriteOnce, storageClassName: fast\". It is stored in etcd with phase Pending. No disk exists yet.",
    { pvc: "Pending" },
  );

  const finalNode = (zone: Zone) => NODES.find((n) => n.zone === zone)!.name;
  const tail = (zone: Zone) => {
    const node = finalNode(zone);
    push(
      ["kcm", "api"],
      "attach/detach controller creates a VolumeAttachment",
      `The pod is now bound to ${node}. kube-controller-manager's attach/detach controller sees a CSI volume that must be attached to that node and creates a VolumeAttachment object (spec.attacher = the driver name, spec.nodeName = ${node}).`,
      { va: "attached=false" },
    );
    push(
      ["attacher", "controller"],
      "external-attacher → ControllerPublishVolume",
      `The external-attacher sidecar watches VolumeAttachments for its driver and calls the controller plugin over the local gRPC socket. For a cloud/hypervisor driver this is "attach disk to VM ${node}" (e.g. hot-plug a SCSI disk). Then it sets status.attached = true. Drivers that need no attach step set attachRequired: false in their CSIDriver and skip this entirely.`,
      { va: "attached=true" },
      "ControllerPublishVolume(volume_id, node_id)",
    );
    push(
      ["kubelet", "nodeplugin"],
      "kubelet → NodeStageVolume (format + global mount)",
      `kubelet on ${node} waits for the VolumeAttachment to report attached, then calls the node plugin (the DaemonSet pod on that node). The plugin finds the block device, runs mkfs if it is blank, and mounts it once per node at the staging path.`,
      { staged: true },
      "NodeStageVolume → /var/lib/kubelet/plugins/kubernetes.io/csi/<driver>/<hash>/globalmount",
    );
    push(
      ["kubelet", "nodeplugin"],
      "kubelet → NodePublishVolume (bind mount into the pod)",
      "A bind mount from the staging path into this specific pod's volume directory. If two pods on the same node share an RWO volume, there is one stage and two publishes.",
      { published: true },
      "NodePublishVolume → /var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~csi/<pv>/mount",
    );
    push(
      ["kubelet", "container"],
      "Container starts and sees /data",
      "The container runtime bind-mounts the pod volume directory at the container's mountPath. From the app's point of view, /data is just a directory, and it doesn't know about CSI.",
      { pod: "Running" },
    );
  };

  if (mode === "Immediate") {
    const zone: Zone = "zone-a";
    push(
      ["provisioner", "controller"],
      "external-provisioner → CreateVolume, immediately",
      "volumeBindingMode: Immediate, so the provisioner sidecar acts as soon as the PVC appears. It knows nothing about the future pod, so the driver picks a topology segment itself (here zone-a), or the first one in allowedTopologies.",
      { diskZone: zone },
      "CreateVolume(name=pvc-<uid>, capacity=10Gi, accessibility_requirements=any)",
    );
    push(
      ["provisioner", "kcm", "api"],
      "PV created with nodeAffinity zone-a, then bound",
      "The provisioner writes a PersistentVolume whose spec.nodeAffinity says topology.kubernetes.io/zone in [zone-a]. The PV controller in kube-controller-manager binds PVC ⇄ PV (claimRef on the PV, volumeName on the PVC).",
      { pv: "Bound", pvc: "Bound" },
    );
    push(["user", "api"], "kubectl apply -f pod.yaml", "The pod references the PVC by name. It lands in the scheduling queue.", { pod: "Pending" });
    if (pinZoneC) {
      push(
        ["scheduler"],
        "Scheduler: no node satisfies both constraints",
        "The pod has nodeSelector zone-c (say, the only GPU node), but the disk was already created in zone-a. The VolumeBinding plugin filters out every node that doesn't match the PV's nodeAffinity, and NodeAffinity filters out everything but zone-c. Result: 0/3 nodes are available: 1 node(s) didn't match Pod's node affinity/selector, 2 node(s) had volume node affinity conflict. The pod is stuck until someone deletes and recreates the claim.",
        { pod: "Unschedulable" },
        undefined,
        true,
      );
      return s;
    }
    push(
      ["scheduler", "api"],
      `Scheduler: only ${finalNode(zone)} can see the disk`,
      `The VolumeBinding filter only keeps nodes matching the PV's nodeAffinity, so the volume decided where the pod runs. The scheduler binds the pod to ${finalNode(zone)}. That works here, but your resource requests, anti-affinity and spreading rules had no say in it.`,
      { pod: "Scheduled", podNode: finalNode(zone) },
    );
    tail(zone);
    return s;
  }

  // WaitForFirstConsumer
  push(
    ["provisioner"],
    "external-provisioner waits",
    "volumeBindingMode: WaitForFirstConsumer. The provisioner sees the PVC but does nothing, because no pod uses it yet. `kubectl describe pvc` shows: waiting for first consumer to be created before binding.",
    { pvcNote: "waiting for first consumer" },
  );
  push(["user", "api"], "kubectl apply -f pod.yaml", "The pod references the PVC by name. It lands in the scheduling queue.", { pod: "Pending" });
  const zone: Zone = pinZoneC ? "zone-c" : "zone-b";
  const node = finalNode(zone);
  push(
    ["scheduler", "api"],
    `Scheduler picks ${node} first and annotates the PVC`,
    `The scheduler runs all its filters and scores (resources, affinity${pinZoneC ? ", the nodeSelector zone-c" : ""}, spreading). The VolumeBinding plugin checks that the StorageClass can provision in that node's topology, then writes volume.kubernetes.io/selected-node: ${node} on the PVC. The pod is not bound to the node yet. PreBind waits for the claim to be bound.`,
    { pvcNote: `selected-node: ${node}` },
  );
  push(
    ["provisioner", "controller"],
    `external-provisioner → CreateVolume in ${zone}`,
    `The provisioner sees the selected-node annotation, reads that node's topology labels (from its CSINode / node labels), and passes them as accessibility requirements. The disk is created where the pod will run.`,
    { diskZone: zone },
    `CreateVolume(name=pvc-<uid>, capacity=10Gi, accessibility_requirements={topology.kubernetes.io/zone: ${zone}})`,
  );
  push(
    ["provisioner", "kcm", "api"],
    `PV created with nodeAffinity ${zone}, then bound`,
    "The PersistentVolume records the topology the driver returned. The PV controller binds the claim. PVC phase → Bound.",
    { pv: "Bound", pvc: "Bound", pvcNote: undefined },
  );
  push(
    ["scheduler", "api"],
    `Scheduler binds the pod to ${node}`,
    "PreBind sees the PVC is bound and the binding cycle finishes. Pod and disk are guaranteed to be in the same topology segment.",
    { pod: "Scheduled", podNode: node },
  );
  tail(zone);
  return s;
}

const ACTOR_LABEL: Record<Actor, string> = {
  user: "you (kubectl)",
  api: "kube-apiserver",
  scheduler: "kube-scheduler",
  kcm: "kube-controller-manager",
  provisioner: "external-provisioner",
  attacher: "external-attacher",
  controller: "CSI controller plugin",
  kubelet: "kubelet",
  nodeplugin: "CSI node plugin",
  container: "container",
};

function Box({ active, label, sub, className, tone = "accent" }: { active: boolean; label: string; sub?: string; className?: string; tone?: "accent" | "blue" }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-2.5 py-1.5 transition-all duration-300",
        active
          ? tone === "accent"
            ? "border-accent bg-accent/10 shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-4px_var(--color-accent)]"
            : "border-accent-2 bg-accent-2/15 shadow-[0_0_0_1px_var(--color-accent-2)]"
          : "border-line bg-panel-2/60",
        className,
      )}
    >
      <div className={clsx("font-mono text-[11.5px]", active ? "text-ink" : "text-muted")}>{label}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{sub}</div>}
    </div>
  );
}

function ObjChip({ kind, value, tone }: { kind: string; value: string; tone: "ok" | "warn" | "bad" | "idle" }) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-2 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors duration-300",
        tone === "ok" && "border-ok/50 bg-ok/10 text-ok",
        tone === "warn" && "border-warn/50 bg-warn/10 text-warn",
        tone === "bad" && "border-bad/50 bg-bad/10 text-bad",
        tone === "idle" && "border-line text-faint",
      )}
    >
      <span className="text-muted">{kind}</span>
      <span>{value}</span>
    </div>
  );
}

export function LifecycleDemo() {
  const [mode, setMode] = useState<Mode>("WaitForFirstConsumer");
  const [pinZoneC, setPinZoneC] = useState(true);
  const steps = useMemo(() => buildSteps(mode, pinZoneC), [mode, pinZoneC]);
  const [i, setI] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setI(-1);
    setPlaying(false);
  }, [mode, pinZoneC]);

  useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((x) => x + 1), i < 0 ? 200 : 2200);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);

  const step = i >= 0 ? steps[i] : null;
  const st = step?.state ?? empty;
  const on = (a: Actor) => !!step?.actors.includes(a);
  const rpcs = steps.slice(0, i + 1).filter((x) => x.rpc);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "Immediate", label: "Immediate" },
            { value: "WaitForFirstConsumer", label: "WaitForFirstConsumer" },
          ]}
        />
        <Toggle checked={pinZoneC} onChange={setPinZoneC} label={<span>pod has <code className="font-mono text-xs text-ink">nodeSelector: zone-c</code></span>} />
        <div className="ml-auto flex gap-2">
          <Button variant="primary" onClick={() => (i >= steps.length - 1 ? (setI(-1), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? "❚❚ Pause" : i >= steps.length - 1 ? "↺ Replay" : "▶ Play"}
          </Button>
          <Button onClick={() => { setPlaying(false); setI((x) => Math.min(x + 1, steps.length - 1)); }} disabled={i >= steps.length - 1}>
            Step →
          </Button>
          <Button variant="ghost" onClick={() => { setPlaying(false); setI(-1); }}>
            Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Cluster" right={<span className="font-mono text-[11px] text-faint">step {Math.max(i + 1, 0)}/{steps.length}</span>}>
          <div className="space-y-3">
            {/* Control plane */}
            <div className="rounded-xl border border-dashed border-line p-3">
              <div className="mb-2 font-mono text-[10px] tracking-wide text-faint uppercase">control plane</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_1fr]">
                <div className="space-y-2">
                  <Box active={on("user")} label="kubectl" sub="you" />
                  <Box active={on("scheduler")} label="kube-scheduler" sub="VolumeBinding plugin" />
                </div>
                <div className={clsx("rounded-lg border p-2 transition-all duration-300", on("api") ? "border-accent bg-accent/5" : "border-line bg-panel-2/40")}>
                  <div className={clsx("mb-1.5 font-mono text-[11.5px]", on("api") ? "text-ink" : "text-muted")}>kube-apiserver / etcd</div>
                  <div className="space-y-1">
                    <ObjChip kind="PVC data" value={st.pvc} tone={st.pvc === "Bound" ? "ok" : st.pvc === "Pending" ? "warn" : "idle"} />
                    {st.pvcNote && <div className="truncate pl-2 font-mono text-[10px] text-warn">↳ {st.pvcNote}</div>}
                    <ObjChip kind="PV pvc-7f3a…" value={st.pv ? `Bound · ${st.diskZone}` : "—"} tone={st.pv ? "ok" : "idle"} />
                    <ObjChip kind="Pod app" value={st.pod + (st.podNode ? ` · ${st.podNode}` : "")} tone={st.pod === "Running" ? "ok" : st.pod === "Unschedulable" ? "bad" : st.pod === "—" ? "idle" : "warn"} />
                    <ObjChip kind="VolumeAttachment" value={st.va ?? "—"} tone={st.va === "attached=true" ? "ok" : st.va ? "warn" : "idle"} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Box active={on("kcm")} label="kube-controller-manager" sub="PV binder · attach/detach" />
                </div>
              </div>
            </div>

            {/* CSI controller */}
            <div className="rounded-xl border border-dashed border-accent-2/40 p-3">
              <div className="mb-2 font-mono text-[10px] tracking-wide text-accent-2 uppercase">csi controller · Deployment (1 replica, leader-elected)</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Box active={on("provisioner")} label="external-provisioner" sub="watches PVCs" />
                <Box active={on("attacher")} label="external-attacher" sub="watches VolumeAttachments" />
                <Box active={false} label="external-resizer" sub="idle here" />
                <Box active={on("controller")} label="driver (controller)" sub="talks to the storage API" tone="blue" />
              </div>
            </div>

            {/* Nodes */}
            <div className="grid gap-2 sm:grid-cols-3">
              {NODES.map((n) => {
                const here = st.podNode === n.name;
                const disk = st.diskZone === n.zone;
                return (
                  <div
                    key={n.name}
                    className={clsx(
                      "rounded-xl border p-2.5 transition-all duration-300",
                      here ? "border-accent/60 bg-accent/5" : "border-line bg-panel-2/30",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-ink">{n.name}</span>
                      <Pill color={n.zone === "zone-c" && pinZoneC ? "var(--color-f4)" : undefined}>{n.zone}</Pill>
                    </div>
                    <div className="space-y-1.5">
                      <Box active={here && on("kubelet")} label="kubelet" />
                      <Box active={here && on("nodeplugin")} label="csi node plugin" sub="DaemonSet pod" tone="blue" />
                      <div className="space-y-1 font-mono text-[10px]">
                        <div className={clsx("rounded border px-1.5 py-0.5 transition-colors", here && st.staged ? "border-ok/50 text-ok" : "border-line text-faint")}>
                          …/globalmount {here && st.staged ? "✓ ext4" : ""}
                        </div>
                        <div className={clsx("rounded border px-1.5 py-0.5 transition-colors", here && st.published ? "border-ok/50 text-ok" : "border-line text-faint")}>
                          …/pods/&lt;uid&gt;/…/mount {here && st.published ? "✓" : ""}
                        </div>
                      </div>
                      <div
                        className={clsx(
                          "rounded-md border px-2 py-1 text-center font-mono text-[11px] transition-all duration-300",
                          here && st.pod === "Running" ? "border-ok bg-ok/10 text-ok" : here ? "border-warn/50 text-warn" : "border-transparent text-transparent",
                          here && on("container") && "animate-flash",
                        )}
                      >
                        {here ? (st.pod === "Running" ? "pod app · /data ✓" : "pod app · ContainerCreating") : "·"}
                      </div>
                    </div>
                    <div
                      className={clsx(
                        "mt-2 rounded-md border border-dashed px-2 py-1 text-center font-mono text-[10.5px] transition-all duration-500",
                        disk ? "border-accent-2 bg-accent-2/10 text-ink" : "border-line text-faint",
                      )}
                    >
                      {disk ? `▣ 10Gi disk (${n.zone} storage)` : `${n.zone} storage`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="What just happened">
            {step ? (
              <div key={i} className="animate-rise space-y-2">
                <div className={clsx("text-sm font-medium", step.bad ? "text-bad" : "text-ink")}>{step.title}</div>
                <div className="flex flex-wrap gap-1">
                  {step.actors.map((a) => (
                    <Pill key={a} color="var(--color-accent)">{ACTOR_LABEL[a]}</Pill>
                  ))}
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{step.detail}</p>
                {step.rpc && <div className="rounded-md border border-accent-2/40 bg-accent-2/10 p-2 font-mono text-[11px] break-all text-ink">gRPC {step.rpc}</div>}
              </div>
            ) : (
              <p className="text-sm text-faint">
                Press <b>Play</b> or <b>Step</b>. Then flip the binding mode and the <code>nodeSelector</code> toggle to see what changes.
              </p>
            )}
          </Panel>
          <Panel title="CSI calls so far">
            {rpcs.length === 0 ? (
              <p className="text-xs text-faint">none yet</p>
            ) : (
              <ol className="space-y-1.5">
                {rpcs.map((r, k) => (
                  <li key={k} className="font-mono text-[11px] text-muted animate-rise">
                    <span className="text-accent-2">{k + 1}.</span> {r.rpc!.split(/[ (]/)[0]}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
