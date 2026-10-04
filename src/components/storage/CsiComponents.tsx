"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Panel, Pill } from "../ui";

type Id =
  | "csidriver"
  | "csinode"
  | "provisioner"
  | "attacher"
  | "resizer"
  | "snapshotter"
  | "ctrldriver"
  | "liveness"
  | "registrar"
  | "nodedriver"
  | "kubelet"
  | "snapcontroller";

const INFO: Record<Id, { name: string; where: string; body: string; watches?: string; calls?: string }> = {
  csidriver: {
    name: "CSIDriver object",
    where: "cluster-scoped API object (storage.k8s.io/v1)",
    body: "Tells Kubernetes how to treat the driver: attachRequired (false skips VolumeAttachment/ControllerPublish entirely, as NFS and local drivers do), podInfoOnMount, fsGroupPolicy (whether kubelet may chown files to the pod's fsGroup), volumeLifecycleModes (Persistent and/or Ephemeral), storageCapacity, and requiresRepublish. Its metadata.name is the driver name that StorageClass.provisioner refers to.",
  },
  csinode: {
    name: "CSINode object",
    where: "one per Node, written by kubelet",
    body: "When node-driver-registrar registers a driver, kubelet records it in the node's CSINode: the node_id the driver uses (e.g. the VM ID), the topology keys it reports, and an optional per-node volume attach limit (allocatable.count) that the scheduler respects.",
  },
  provisioner: {
    name: "external-provisioner",
    where: "sidecar in the controller Deployment",
    watches: "PersistentVolumeClaims whose StorageClass.provisioner matches the driver",
    calls: "CreateVolume / DeleteVolume",
    body: "Turns a claim into a real volume and a PV. Honors volumeBindingMode: with WaitForFirstConsumer it waits for the scheduler's selected-node annotation and forwards that node's topology. On PVC deletion with reclaimPolicy Delete, it calls DeleteVolume and removes the PV.",
  },
  attacher: {
    name: "external-attacher",
    where: "sidecar in the controller Deployment",
    watches: "VolumeAttachment objects for this driver",
    calls: "ControllerPublishVolume / ControllerUnpublishVolume",
    body: "The attach/detach controller in kube-controller-manager decides that a volume must be attached to a node and creates the VolumeAttachment. This sidecar does the actual attach (hot-plug a disk into a VM, map a LUN) and reports status.attached. It isn't needed when CSIDriver.attachRequired is false.",
  },
  resizer: {
    name: "external-resizer",
    where: "sidecar in the controller Deployment",
    watches: "PVCs whose spec.resources.requests.storage grew",
    calls: "ControllerExpandVolume",
    body: "Grows the backend volume. If the driver also needs the filesystem grown on the node, kubelet follows with NodeExpandVolume (online, while the pod keeps running, for most drivers). Requires allowVolumeExpansion: true on the StorageClass. Volumes can't shrink.",
  },
  snapshotter: {
    name: "csi-snapshotter",
    where: "sidecar in the controller Deployment",
    watches: "VolumeSnapshotContent objects",
    calls: "CreateSnapshot / DeleteSnapshot",
    body: "Driver-side half of snapshots. It only works if the snapshot CRDs (snapshot.storage.k8s.io/v1) and the cluster-wide snapshot-controller are installed. Those are not part of core Kubernetes, and many distributions, Talos included, don't ship them by default.",
  },
  snapcontroller: {
    name: "snapshot-controller",
    where: "one cluster-wide Deployment (not per driver)",
    watches: "VolumeSnapshot objects",
    body: "Like the PV controller, but for snapshots: binds a VolumeSnapshot (namespaced, user-facing) to a VolumeSnapshotContent (cluster-scoped, the real thing) using a VolumeSnapshotClass. You install it once, alongside the CRDs from kubernetes-csi/external-snapshotter.",
  },
  ctrldriver: {
    name: "CSI driver (controller mode)",
    where: "vendor container in the controller Deployment",
    calls: "serves Controller + Identity gRPC on unix:///csi/csi.sock",
    body: "The only vendor-specific code in the controller pod. It speaks the storage system's API (Proxmox, Ceph, Longhorn, a cloud) and has no Kubernetes knowledge at all. The sidecars translate Kubernetes objects into CSI calls on a shared emptyDir socket. That split is the point: one set of Kubernetes-aware sidecars, many drivers.",
  },
  liveness: {
    name: "livenessprobe",
    where: "sidecar in both Deployment and DaemonSet",
    calls: "Probe",
    body: "Exposes an HTTP /healthz that calls the driver's Probe RPC, so Kubernetes can restart a wedged driver container.",
  },
  registrar: {
    name: "node-driver-registrar",
    where: "sidecar in the node DaemonSet",
    calls: "NodeGetInfo (once, at startup)",
    body: "Drops a registration socket into /var/lib/kubelet/plugins_registry/. kubelet's plugin watcher finds it, learns the driver name and the path of the driver's own socket (under /var/lib/kubelet/plugins/<driver>/csi.sock), and writes the node into CSINode. Without this, kubelet doesn't know the driver exists on the node.",
  },
  nodedriver: {
    name: "CSI driver (node mode)",
    where: "privileged container in the node DaemonSet",
    calls: "NodeStageVolume / NodePublishVolume / NodeExpandVolume / NodeGetVolumeStats",
    body: "Runs on every node with hostPath access to /dev and /var/lib/kubelet, and mount propagation Bidirectional so mounts it makes are visible to kubelet and the containers. It formats devices, mounts the per-node staging path, then bind-mounts into each pod. On Talos it often needs system extensions (iscsi-tools, util-linux-tools) for the host-side tools it calls.",
  },
  kubelet: {
    name: "kubelet",
    where: "on every node (on Talos: a container managed by machined)",
    calls: "calls the node plugin's socket directly",
    body: "There's no sidecar between kubelet and the node plugin. kubelet is itself a CSI client: once the volume is attached it calls NodeStage then NodePublish, and on pod teardown NodeUnpublish then NodeUnstage. On Talos, kubelet only sees host paths that are mounted into its container. That's why local-storage provisioners need kubelet extraMounts.",
  },
};

function Node({ id, sel, set, children, tone }: { id: Id; sel: Id; set: (i: Id) => void; children?: ReactNode; tone?: "blue" | "accent" | "obj" }) {
  const active = sel === id;
  return (
    <button
      type="button"
      onClick={() => set(id)}
      aria-pressed={active}
      className={clsx(
        "w-full rounded-lg border px-2.5 py-2 text-left font-mono text-[11.5px] transition-all",
        active ? "border-accent bg-accent/10 text-ink shadow-[0_0_0_1px_var(--color-accent)]" : "border-line bg-panel-2/60 text-muted hover:border-faint hover:text-ink",
        tone === "blue" && !active && "border-accent-2/50",
        tone === "obj" && !active && "border-dashed",
      )}
    >
      {children ?? INFO[id].name}
    </button>
  );
}

export function CsiComponents() {
  const [sel, setSel] = useState<Id>("provisioner");
  const info = INFO[sel];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Panel title="Anatomy of a CSI driver · click anything">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-line p-3">
              <div className="mb-2 font-mono text-[10px] tracking-wide text-faint uppercase">API objects</div>
              <div className="grid grid-cols-2 gap-2">
                <Node id="csidriver" sel={sel} set={setSel} tone="obj" />
                <Node id="csinode" sel={sel} set={setSel} tone="obj" />
              </div>
              <div className="mt-2">
                <Node id="snapcontroller" sel={sel} set={setSel} />
              </div>
            </div>
            <div className="rounded-xl border border-accent-2/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-wide text-accent-2 uppercase">controller · Deployment</span>
                <Pill>1–2 replicas, leader election</Pill>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Node id="provisioner" sel={sel} set={setSel} />
                <Node id="attacher" sel={sel} set={setSel} />
                <Node id="resizer" sel={sel} set={setSel} />
                <Node id="snapshotter" sel={sel} set={setSel} />
              </div>
              <svg viewBox="0 0 200 24" className="my-1 h-6 w-full" aria-hidden>
                <path d="M40 0 V12 H160 V0 M100 12 V24" fill="none" stroke="var(--color-accent-2)" strokeWidth="1.2" strokeDasharray="4 4" className="animate-dash" />
              </svg>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Node id="ctrldriver" sel={sel} set={setSel} tone="blue" />
                <Node id="liveness" sel={sel} set={setSel}>probe</Node>
              </div>
              <div className="mt-1.5 text-center font-mono text-[10px] text-faint">shared emptyDir · /csi/csi.sock (gRPC)</div>
            </div>
          </div>

          <div className="rounded-xl border border-accent-2/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-wide text-accent-2 uppercase">node · DaemonSet (every node)</span>
              <Pill>privileged</Pill>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Node id="registrar" sel={sel} set={setSel} />
              <Node id="liveness" sel={sel} set={setSel}>probe</Node>
            </div>
            <svg viewBox="0 0 200 22" className="my-1 h-5 w-full" aria-hidden>
              <path d="M100 0 V22" fill="none" stroke="var(--color-accent-2)" strokeWidth="1.2" strokeDasharray="4 4" className="animate-dash" />
            </svg>
            <Node id="nodedriver" sel={sel} set={setSel} tone="blue" />
            <div className="mt-1.5 text-center font-mono text-[10px] text-faint">/var/lib/kubelet/plugins/&lt;driver&gt;/csi.sock</div>
            <svg viewBox="0 0 200 22" className="my-1 h-5 w-full" aria-hidden>
              <path d="M100 22 V0" fill="none" stroke="var(--color-accent)" strokeWidth="1.2" strokeDasharray="4 4" className="animate-dash" />
            </svg>
            <Node id="kubelet" sel={sel} set={setSel} />
            <div className="mt-3 space-y-1 rounded-lg border border-line bg-bg/60 p-2 font-mono text-[10.5px] text-faint">
              <div>/var/lib/kubelet/plugins_registry/ ← registration</div>
              <div>/var/lib/kubelet/plugins/kubernetes.io/csi/… ← staging</div>
              <div>/var/lib/kubelet/pods/&lt;uid&gt;/volumes/… ← publish</div>
              <div>/dev ← block devices</div>
            </div>
          </div>
        </div>
      </Panel>
      <Panel title={info.name}>
        <div key={sel} className="animate-rise space-y-3 text-[13px] leading-relaxed">
          <div className="font-mono text-[11px] text-faint">{info.where}</div>
          {info.watches && (
            <div>
              <span className="text-[11px] tracking-wide text-faint uppercase">watches</span>
              <div className="text-ink">{info.watches}</div>
            </div>
          )}
          {info.calls && (
            <div>
              <span className="text-[11px] tracking-wide text-faint uppercase">CSI</span>
              <div className="font-mono text-[12px] text-accent-2">{info.calls}</div>
            </div>
          )}
          <p className="text-muted">{info.body}</p>
        </div>
      </Panel>
    </div>
  );
}
