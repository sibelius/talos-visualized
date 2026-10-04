"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Pill, Segmented } from "../ui";

type Mode = "ReadWriteOnce" | "ReadWriteOncePod" | "ReadOnlyMany" | "ReadWriteMany";
type Backend = "block" | "file";

const PODS = [
  { name: "web-0", node: "worker-1", wants: "rw" },
  { name: "web-1", node: "worker-1", wants: "rw" },
  { name: "web-2", node: "worker-2", wants: "rw" },
  { name: "report", node: "worker-3", wants: "ro" },
] as const;

const MODE_INFO: Record<Mode, { short: string; text: string }> = {
  ReadWriteOnce: {
    short: "RWO",
    text: "Read-write by a single node, not a single pod. Every pod on the node holding the attachment can mount it. A pod on another node gets stuck in ContainerCreating with a Multi-Attach error until the first node lets go.",
  },
  ReadWriteOncePod: {
    short: "RWOP",
    text: "Read-write by exactly one pod in the whole cluster (GA since Kubernetes 1.29, CSI only). The scheduler enforces it, so a second pod stays Pending instead of half-starting. Use it when two writers would corrupt the data, for example a single-instance database.",
  },
  ReadOnlyMany: {
    short: "ROX",
    text: "Many nodes, read-only. Useful for shared, pre-populated data (e.g. a volume restored from a snapshot). A freshly provisioned empty ROX volume isn't very useful.",
  },
  ReadWriteMany: {
    short: "RWX",
    text: "Many nodes read-write at once. This needs a filesystem that coordinates concurrent writers (NFS, CephFS, a Longhorn share-manager, etc). A plain block device formatted with ext4/xfs can't safely be mounted on two nodes.",
  },
};

function outcome(mode: Mode, backend: Backend, i: number): { ok: boolean; label: string; why: string } {
  const p = PODS[i];
  if (backend === "block" && (mode === "ReadWriteMany" || mode === "ReadOnlyMany")) {
    return { ok: false, label: "Pending", why: "The PVC never binds: the driver rejects CreateVolume because a block disk with a local filesystem can't be shared across nodes." };
  }
  switch (mode) {
    case "ReadWriteOnce":
      if (p.node === "worker-1") return { ok: true, label: "Running · rw", why: "Same node as the attachment, so it shares the one staging mount." };
      return { ok: false, label: "ContainerCreating", why: "Multi-Attach error: volume is already exclusively attached to worker-1." };
    case "ReadWriteOncePod":
      if (i === 0) return { ok: true, label: "Running · rw", why: "First pod to claim it wins." };
      return { ok: false, label: "Pending", why: "Unschedulable: the claim is already in use by another pod (ReadWriteOncePod)." };
    case "ReadOnlyMany":
      return { ok: true, label: "Running · ro", why: p.wants === "rw" ? "Mounts fine, but every write gets EROFS. The app has to treat it as read-only." : "Reads shared data." };
    case "ReadWriteMany":
      return { ok: true, label: "Running · rw", why: "Shared filesystem: every node mounts the same export." };
  }
}

type Phase = "bound" | "pvc-deleting" | "released" | "gone";

export function AccessModes() {
  const [mode, setMode] = useState<Mode>("ReadWriteOnce");
  const [backend, setBackend] = useState<Backend>("block");
  const [hover, setHover] = useState<number | null>(null);

  return (
    <Panel
      title="Access modes · 4 pods share one PVC"
      right={
        <Segmented
          value={backend}
          onChange={setBackend}
          options={[
            { value: "block", label: "block disk (Proxmox CSI, RBD)" },
            { value: "file", label: "shared FS (CephFS, NFS)" },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={(Object.keys(MODE_INFO) as Mode[]).map((m) => ({ value: m, label: `${MODE_INFO[m].short} · ${m}` }))}
        />
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted">{MODE_INFO[mode].text}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {["worker-1", "worker-2", "worker-3"].map((node) => (
            <div key={node} className="rounded-xl border border-line bg-panel-2/30 p-3">
              <div className="mb-2 font-mono text-[11.5px] text-ink">{node}</div>
              <div className="space-y-2">
                {PODS.map((p, i) =>
                  p.node !== node ? null : (
                    <PodCard key={p.name + mode + backend} name={p.name} wants={p.wants} o={outcome(mode, backend, i)} onHover={(h) => setHover(h ? i : null)} />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="min-h-10 text-[12.5px] text-muted">
          {hover !== null ? (
            <span>
              <b className="font-mono text-ink">{PODS[hover].name}</b>: {outcome(mode, backend, hover).why}
            </span>
          ) : (
            <span className="text-faint">Hover or tap a pod to see why.</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function PodCard({ name, wants, o, onHover }: { name: string; wants: string; o: { ok: boolean; label: string; why: string }; onHover: (h: boolean) => void }) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onClick={() => onHover(true)}
      className={clsx(
        "w-full animate-rise rounded-lg border px-2.5 py-2 text-left transition",
        o.ok ? "border-ok/50 bg-ok/5" : "border-bad/50 bg-bad/5",
      )}
    >
      <div className="flex items-center justify-between font-mono text-[12px]">
        <span className="text-ink">{name}</span>
        <span className="text-[10px] text-faint">wants {wants}</span>
      </div>
      <div className={clsx("mt-0.5 font-mono text-[11px]", o.ok ? "text-ok" : "text-bad")}>{o.label}</div>
    </button>
  );
}

export function ReclaimDemo() {
  const [policy, setPolicy] = useState<"Delete" | "Retain">("Delete");
  const [phase, setPhase] = useState<Phase>("bound");

  useEffect(() => {
    if (phase === "pvc-deleting") {
      const t = setTimeout(() => setPhase("released"), 1300);
      return () => clearTimeout(t);
    }
    if (phase === "released" && policy === "Delete") {
      const t = setTimeout(() => setPhase("gone"), 1500);
      return () => clearTimeout(t);
    }
  }, [phase, policy]);

  useEffect(() => setPhase("bound"), [policy]);

  const pvc = phase === "bound" ? "Bound" : phase === "pvc-deleting" ? "Terminating" : "—";
  const pv = phase === "bound" || phase === "pvc-deleting" ? "Bound" : phase === "released" ? "Released" : "—";
  const disk = phase === "gone" ? "deleted" : "exists · 10Gi of data";

  const explain: Record<Phase, string> = {
    bound: `PV persistentVolumeReclaimPolicy: ${policy} (copied from the StorageClass's reclaimPolicy at provisioning time). Delete the claim to see what happens.`,
    "pvc-deleting":
      "The PVC carries the kubernetes.io/pvc-protection finalizer. It stays Terminating while any pod still mounts it, then goes away.",
    released:
      policy === "Delete"
        ? "The PV goes Released. external-provisioner sees reclaimPolicy Delete and calls DeleteVolume on the driver…"
        : "The PV is Released and still has claimRef pointing at the dead PVC, so no new claim can bind it. The data is safe. To reuse it, an admin clears spec.claimRef (or creates a new PV with the same volumeHandle) and binds a new PVC to it explicitly. Deleting the PV later does not delete the backend disk.",
    gone: "DeleteVolume succeeded: the backend disk and the PV are gone. Delete is the default for dynamically provisioned volumes. It's convenient for scratch data, and a bad surprise if someone deletes a namespace by mistake.",
  };

  return (
    <Panel
      title="Reclaim policy · what deleting a PVC does"
      right={<Segmented value={policy} onChange={setPolicy} options={["Delete", "Retain"] as const} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip k="PVC data" v={pvc} tone={pvc === "Bound" ? "ok" : pvc === "Terminating" ? "warn" : "idle"} />
          <span className="text-faint">→</span>
          <Chip k="PV pvc-7f3a…" v={pv} tone={pv === "Bound" ? "ok" : pv === "Released" ? "warn" : "idle"} />
          <span className="text-faint">→</span>
          <Chip k="backend disk" v={disk} tone={phase === "gone" ? "bad" : "ok"} />
          <div className="ml-auto flex gap-2">
            <Button variant="danger" onClick={() => setPhase("pvc-deleting")} disabled={phase !== "bound"}>
              kubectl delete pvc data
            </Button>
            <Button variant="ghost" onClick={() => setPhase("bound")}>
              Reset
            </Button>
          </div>
        </div>
        <p key={phase} className="max-w-3xl animate-rise text-[13px] leading-relaxed text-muted">
          {explain[phase]}
        </p>
        {policy === "Retain" && phase === "released" && (
          <div className="flex flex-wrap gap-2">
            <Pill color="var(--color-warn)">kubectl patch pv pvc-7f3a… -p &apos;{"{"}&quot;spec&quot;:{"{"}&quot;claimRef&quot;:null{"}}"}&apos;</Pill>
            <Pill>→ Available again</Pill>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Chip({ k, v, tone }: { k: string; v: string; tone: "ok" | "warn" | "bad" | "idle" }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors duration-500",
        tone === "ok" && "border-ok/50 bg-ok/10",
        tone === "warn" && "border-warn/50 bg-warn/10",
        tone === "bad" && "border-bad/50 bg-bad/10",
        tone === "idle" && "border-line opacity-60",
      )}
    >
      <div className="text-[10px] text-faint">{k}</div>
      <div className={clsx(tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad", tone === "idle" && "text-faint")}>{v}</div>
    </div>
  );
}
