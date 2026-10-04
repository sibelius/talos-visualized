"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Callout, Panel, Pill, Segmented } from "@/components/ui";
import { DiskIcon, EventLog, HostBox, VmChip, useTimeline } from "@/components/proxmox/parts";

type Store = "local" | "shared";
type Ev = { who: string; msg: React.ReactNode; tone?: "ok" | "bad" | "warn" | "info" };

const NODES = [
  { name: "worker-2a", vmid: 112, host: "pve2" },
  { name: "worker-2b", vmid: 122, host: "pve2" },
  { name: "worker-3a", vmid: 113, host: "pve3" },
];

type State = {
  podOn: string | null; // node name; null = Pending
  attachedTo: string | null;
  diskZone: string; // for local storage
  blocked: boolean;
};

const START: State = { podOn: "worker-2a", attachedTo: "worker-2a", diskZone: "pve2", blocked: false };

export function MoveDemo() {
  const [store, setStore] = useState<Store>("local");
  const [st, setSt] = useState<State>(START);
  const [log, setLog] = useState<Ev[]>([]);
  const tl = useTimeline(1000);

  const push = (e: Ev) => setLog((l) => [...l.slice(-30), e]);
  const patch = (p: Partial<State>) => setSt((s) => ({ ...s, ...p }));

  const reset = (nextStore = store) => {
    tl.cancel();
    setStore(nextStore);
    setSt(START);
    setLog([]);
  };

  const node = (n: string) => NODES.find((x) => x.name === n)!;

  const moveTo = (target: string) => {
    const from = st.podOn!;
    const t = node(target);
    const crossZone = store === "local" && t.host !== st.diskZone;
    const steps: (() => void)[] = [
      () => {
        patch({ podOn: null });
        push({ who: "kubectl", msg: `drain ${from} → pg-0 evicted, StatefulSet recreates it` });
      },
      () => {
        patch({ attachedTo: null });
        push({ who: "attacher", msg: `ControllerUnpublishVolume: detach scsi1 from VM ${node(from).vmid}`, tone: "info" });
      },
    ];
    if (crossZone) {
      steps.push(() => {
        patch({ blocked: true });
        push({
          who: "scheduler",
          msg: `pg-0 Pending: ${target} … had volume node affinity conflict (PV requires zone=${st.diskZone})`,
          tone: "bad",
        });
      });
    } else {
      steps.push(
        () => push({ who: "scheduler", msg: `pg-0 → ${target} (${store === "shared" ? "PV only pins region" : `same zone ${t.host}`})` }),
        () => {
          patch({ attachedTo: target });
          push({ who: "attacher", msg: `ControllerPublishVolume: hot-plug into VM ${t.vmid} on ${t.host}`, tone: "info" });
        },
        () => {
          patch({ podOn: target });
          push({ who: "node-plugin", msg: "NodeStage (already formatted → just mount) + NodePublish → Running", tone: "ok" });
        },
      );
    }
    tl.run(steps);
  };

  const migrate = () => {
    tl.run([
      () => push({ who: "pvecsictl", msg: "migrate -n default data-pg-0 pve3  (root@pam credentials)" }),
      () => push({ who: "pve", msg: `move disk vm-9999-pvc-6f1c… pve2 → pve3`, tone: "info" }),
      () => {
        patch({ diskZone: "pve3" });
        push({ who: "pvecsictl", msg: "replace PV nodeAffinity: zone In [pve3]", tone: "ok" });
      },
      () => {
        patch({ blocked: false });
        push({ who: "scheduler", msg: "pg-0 → worker-3a" });
      },
      () => {
        patch({ attachedTo: "worker-3a" });
        push({ who: "attacher", msg: "ControllerPublishVolume: hot-plug into VM 113 on pve3", tone: "info" });
      },
      () => {
        patch({ podOn: "worker-3a" });
        push({ who: "node-plugin", msg: "mount → pg-0 Running, data intact", tone: "ok" });
      },
    ]);
  };

  const busy = tl.running;

  return (
    <Panel
      title="What if the pod moves?"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={store}
            onChange={(v) => reset(v)}
            options={[
              { value: "local", label: "local-lvm / zfs" },
              { value: "shared", label: "ceph-rbd / nfs" },
            ]}
          />
          <Button variant="ghost" onClick={() => reset()}>
            Reset
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {["pve1", "pve2", "pve3"].map((h) => (
              <HostBox key={h} name={h} active={st.podOn ? node(st.podOn).host === h : false}>
                {NODES.filter((n) => n.host === h).map((n) => (
                  <VmChip
                    key={n.name}
                    name={n.name}
                    vmid={n.vmid}
                    tone={st.podOn === n.name ? "ok" : st.attachedTo === n.name ? "active" : "default"}
                  >
                    <div className="mt-1 flex min-h-4 flex-wrap gap-1">
                      {st.podOn === n.name && <span className="animate-rise rounded bg-ok/20 px-1 font-mono text-[9px] text-ok">pg-0</span>}
                      {st.attachedTo === n.name && <span className="animate-rise rounded bg-info/20 px-1 font-mono text-[9px] text-info">scsi1</span>}
                    </div>
                  </VmChip>
                ))}
                {h === "pve1" && <div className="py-3 text-center font-mono text-[10px] text-faint">(other workloads)</div>}
                {store === "local" && (
                  <div className="rounded-md border border-dashed border-line p-1">
                    <div className="font-mono text-[9px] text-faint">local-lvm</div>
                    {st.diskZone === h && (
                      <div className="mt-0.5 flex animate-rise items-center gap-1 font-mono text-[9px] text-info">
                        <DiskIcon className="size-3 shrink-0" /> pvc-6f1c…
                      </div>
                    )}
                  </div>
                )}
              </HostBox>
            ))}
          </div>
          {store === "shared" && (
            <div className="flex items-center gap-1.5 rounded-md border border-dashed border-accent-2/50 bg-accent-2/5 p-2 font-mono text-[10px] text-accent-2">
              <DiskIcon className="size-3.5" /> ceph-rbd: pvc-6f1c… is visible from pve1, pve2 and pve3
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Reschedule pg-0 to:</span>
            {NODES.map((n) => (
              <Button key={n.name} disabled={busy || !st.podOn || st.podOn === n.name} onClick={() => moveTo(n.name)}>
                {n.name} <span className="font-mono text-[10px] text-faint">({n.host})</span>
              </Button>
            ))}
            {st.blocked && (
              <Button variant="primary" disabled={busy} onClick={migrate}>
                pvecsictl migrate → pve3
              </Button>
            )}
          </div>
          <EventLog items={log} />
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed">
            <div className="mb-1 text-faint"># PV nodeAffinity</div>
            <div className="text-muted">topology.kubernetes.io/region In [cluster-1]</div>
            {store === "local" ? (
              <div className={clsx("transition", st.blocked ? "text-bad" : "text-warn")}>topology.kubernetes.io/zone In [{st.diskZone}]</div>
            ) : (
              <div className="text-faint"># no zone term: any host in the region</div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-faint">pod:</span>
              <Pill color={st.podOn ? "var(--color-ok)" : st.blocked ? "var(--color-bad)" : "var(--color-warn)"}>
                {st.podOn ? `Running on ${st.podOn}` : st.blocked ? "Pending: volume node affinity conflict" : "Pending"}
              </Pill>
            </div>
          </div>
          {store === "local" ? (
            <Callout tone="warn" title="Local storage pins the pod to a Proxmox host">
              A disk on <code className="font-mono">lvmthin</code>, <code className="font-mono">zfspool</code> or a local dir only exists on one host.
              It can be moved to another VM <em>on that host</em> (detach, then attach), and the CSI plugin does this for you. Moving it to another host
              is an offline copy: <code className="font-mono">pvecsictl migrate</code> moves the disk and rewrites the PV&apos;s zone. On ZFS you can
              instead set <code className="font-mono">replicate: &quot;true&quot;</code> with <code className="font-mono">replicateZones</code> (up to two zones) to keep a ZFS replica ready on another host.
            </Callout>
          ) : (
            <Callout tone="ok" title="Shared storage only pins the region">
              For storage marked <code className="font-mono">shared</code> in Proxmox (Ceph RBD, NFS…), the plugin provisions volumes with a
              region-only topology. A pod can move to any host in that Proxmox cluster, and the disk is detached from one VM and attached to the other.
              It is still <code className="font-mono">ReadWriteOnce</code>: one VM at a time.
            </Callout>
          )}
        </div>
      </div>
    </Panel>
  );
}
