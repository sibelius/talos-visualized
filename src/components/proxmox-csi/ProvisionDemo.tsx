"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Pill, Segmented } from "@/components/ui";
import { DiskIcon, EventLog, HostBox, LiveText, StepControls, StepList, VmChip, useStepper, type YLine } from "@/components/proxmox/parts";

type Store = "local-lvm" | "ceph-rbd";

const UUID = "6f1c2a7e-93d4-4b8a-a0e5-1d2c3b4a5f60";
const DISK = `vm-9999-pvc-${UUID}`;
const WWN = "0x5c0a1e8f3d2b9a47";

const STEPS = [
  { who: "kubectl", title: "PVC created: Pending (WaitForFirstConsumer)" },
  { who: "scheduler", title: "Pod scheduled to worker-2 (zone pve2)" },
  { who: "controller", title: "CreateVolume: allocate disk on Proxmox" },
  { who: "controller", title: "ControllerPublishVolume: hot-plug into VM" },
  { who: "node", title: "NodeStageVolume: find device, mkfs, mount" },
  { who: "node", title: "NodePublishVolume: bind-mount into the pod" },
];

export function ProvisionDemo() {
  const [store, setStore] = useState<Store>("local-lvm");
  const last = STEPS.length - 1;
  const s = useStepper(last, 1900);
  const st = s.step;
  const shared = store === "ceph-rbd";

  const handle = shared ? `cluster-1//${store}/${DISK}` : `cluster-1/pve2/${store}/${DISK}`;

  const log: { who: string; msg: React.ReactNode; tone?: "ok" | "bad" | "warn" | "info" }[] = [
    { who: "pvc", msg: "data-pg-0 Pending: waiting for first consumer to be created before binding", tone: "warn" },
  ];
  if (st >= 1) log.push({ who: "scheduler", msg: "pg-0 → worker-2 · PVC annotated volume.kubernetes.io/selected-node=worker-2" });
  if (st >= 2) {
    log.push({ who: "provisioner", msg: `CreateVolume(10Gi, storage=${store}, topology={region: cluster-1, zone: pve2})` });
    log.push({ who: "pve", msg: `POST /nodes/pve2/storage/${store}/content vmid=9999 filename=${DISK.slice(0, 20)}…`, tone: "info" });
    log.push({ who: "provisioner", msg: `PV pvc-${UUID.slice(0, 8)}… created & bound`, tone: "ok" });
  }
  if (st >= 3) {
    log.push({ who: "attacher", msg: "VolumeAttachment csi-…  node=worker-2" });
    log.push({ who: "pve", msg: `POST /nodes/pve2/qemu/112/config scsi1=${store}:${DISK.slice(0, 14)}…,wwn=${WWN}`, tone: "info" });
  }
  if (st >= 4) log.push({ who: "node-plugin", msg: `NodeStage: /dev/disk/by-id/wwn-${WWN} → mkfs.xfs → mount …/globalmount` });
  if (st >= 5) log.push({ who: "node-plugin", msg: "NodePublish: bind mount → pod pg-0 Running", tone: "ok" });

  const pvc: YLine[] = [
    { t: "kind: PersistentVolumeClaim" },
    { t: "metadata:" },
    { t: "  name: data-pg-0" },
    ...(st >= 1 ? [{ t: "  annotations:", tone: st === 1 ? ("new" as const) : undefined }, { t: "    volume.kubernetes.io/selected-node: worker-2", tone: st === 1 ? ("new" as const) : undefined }] : []),
    { t: "spec:" },
    { t: "  storageClassName: proxmox-data" },
    { t: "  resources: { requests: { storage: 10Gi } }" },
    ...(st >= 2 ? [{ t: `  volumeName: pvc-${UUID.slice(0, 8)}…`, tone: st === 2 ? ("new" as const) : undefined }] : []),
    { t: `status: { phase: ${st >= 2 ? "Bound" : "Pending"} }`, tone: st >= 2 ? (st === 2 ? "new" : undefined) : "warn" },
  ];

  const pv: YLine[] =
    st >= 2
      ? [
          { t: "kind: PersistentVolume" },
          { t: "spec:" },
          { t: "  csi:" },
          { t: "    driver: csi.proxmox.sinextra.dev" },
          { t: "    fsType: xfs" },
          { t: `    volumeHandle: ${handle}`, tone: st === 2 ? "new" : undefined },
          { t: "  nodeAffinity:" },
          { t: "    required:" },
          { t: "      nodeSelectorTerms:" },
          { t: "      - matchExpressions:" },
          { t: "        - key: topology.kubernetes.io/region", tone: st === 2 ? "new" : undefined },
          { t: "          operator: In" },
          { t: "          values: [cluster-1]" },
          ...(shared
            ? [{ t: "        # shared storage: no zone term", tone: "dim" as const }]
            : [
                { t: "        - key: topology.kubernetes.io/zone", tone: st === 2 ? ("new" as const) : ("warn" as const) },
                { t: "          operator: In" },
                { t: "          values: [pve2]", tone: st === 2 ? ("new" as const) : ("warn" as const) },
              ]),
        ]
      : [{ t: "# no PV yet — nothing is provisioned until a pod", tone: "dim" }, { t: "# using the claim is scheduled", tone: "dim" }];

  const vmcfg: YLine[] = [
    { t: "boot: order=scsi0" },
    { t: "cores: 4" },
    { t: "memory: 8192" },
    { t: "name: worker-2" },
    { t: "net0: virtio=BC:24:11:3A:7E:02,bridge=vmbr0" },
    { t: "scsi0: local-lvm:vm-112-disk-0,discard=on,size=32G,ssd=1" },
    ...(st >= 3
      ? [{ t: `scsi1: ${store}:${DISK.slice(0, 21)}…,discard=on,size=10G,ssd=1,wwn=${WWN}`, tone: st === 3 ? ("new" as const) : ("warn" as const) }]
      : []),
    { t: "scsihw: virtio-scsi-pci" },
    { t: "smbios1: uuid=9d2e7b13-08aa-4c4e-b6f1-6a3f0c8e2b42" },
  ];

  const inVm: YLine[] = [
    { t: "$ ls /dev/disk/by-id/ | grep wwn", tone: "dim" },
    ...(st >= 3 ? [{ t: `wwn-${WWN} -> ../../sdb`, tone: st === 3 ? ("new" as const) : undefined }] : [{ t: "(nothing yet)", tone: "dim" as const }]),
    { t: "$ findmnt -S /dev/sdb", tone: "dim" },
    ...(st >= 4
      ? [{ t: "/var/lib/kubelet/plugins/kubernetes.io/csi/csi.proxmox.sinextra.dev/<hash>/globalmount  xfs", tone: st === 4 ? ("new" as const) : undefined }]
      : []),
    ...(st >= 5
      ? [{ t: "/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~csi/pvc-6f1c…/mount  xfs", tone: st === 5 ? ("new" as const) : undefined }]
      : []),
  ];

  const pod = st >= 5 ? "Running" : st >= 1 ? "ContainerCreating" : "Pending";

  return (
    <Panel
      title="From PVC to a SCSI disk inside the VM"
      right={
        <Segmented
          value={store}
          onChange={(v) => {
            setStore(v);
            s.reset();
          }}
          options={[
            { value: "local-lvm", label: "local-lvm (lvmthin)" },
            { value: "ceph-rbd", label: "ceph-rbd (shared)" },
          ]}
        />
      }
    >
      <div className="mb-4">
        <StepControls s={s} last={last} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <StepList steps={STEPS} current={st} onPick={s.setStep} />

        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-line p-2">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
              <span className="text-ink">
                Proxmox <span className="text-accent">cluster-1</span>
              </span>
              <span className="flex items-center gap-1.5">
                pod pg-0
                <Pill color={pod === "Running" ? "var(--color-ok)" : "var(--color-warn)"}>{pod}</Pill>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["pve1", "pve2", "pve3"] as const).map((h, i) => {
                const me = h === "pve2";
                return (
                  <HostBox key={h} name={h} active={me && st >= 1}>
                    <VmChip name={`worker-${i + 1}`} vmid={111 + i} tone={me && st >= 5 ? "ok" : me && st >= 1 ? "active" : "default"}>
                      {me && st >= 1 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={clsx("rounded px-1 font-mono text-[9px]", st >= 5 ? "bg-ok/20 text-ok" : "bg-accent/20 text-accent")}>pg-0</span>
                          {st >= 3 && <span className="animate-rise rounded bg-info/20 px-1 font-mono text-[9px] text-info">scsi1</span>}
                        </div>
                      )}
                    </VmChip>
                    {!shared && (
                      <div className="rounded-md border border-dashed border-line p-1">
                        <div className="font-mono text-[9px] text-faint">local-lvm</div>
                        {me && st >= 2 && (
                          <div className="mt-0.5 flex animate-rise items-center gap-1 font-mono text-[9px] text-info">
                            <DiskIcon className="size-3 shrink-0" />
                            <span className="truncate">vm-9999-pvc-6f1c…</span>
                          </div>
                        )}
                      </div>
                    )}
                  </HostBox>
                );
              })}
            </div>
            {shared && (
              <div className="mt-1.5 rounded-md border border-dashed border-accent-2/50 bg-accent-2/5 p-1.5">
                <div className="font-mono text-[10px] text-accent-2">ceph-rbd · shared: reachable from every host</div>
                {st >= 2 && (
                  <div className="mt-0.5 flex animate-rise items-center gap-1 font-mono text-[10px] text-info">
                    <DiskIcon className="size-3 shrink-0" />
                    {DISK.slice(0, 22)}…
                  </div>
                )}
              </div>
            )}
          </div>
          <EventLog items={log} />
        </div>

        <div className="min-w-0 space-y-3">
          <LiveText title="qm config 112   # worker-2 on pve2" lines={vmcfg} />
          <LiveText title="inside the worker VM (node plugin's view)" lines={inVm} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <LiveText title="kubectl get pvc data-pg-0 -o yaml" lines={pvc} />
        <LiveText title="kubectl get pv -o yaml" lines={pv} />
      </div>
    </Panel>
  );
}
