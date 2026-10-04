import Link from "next/link";
import { Callout, Matrix, PageHeader, Panel, Pill, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { SCS, type Tri } from "@/components/storageclasses/data";
import { NodeFailureSim } from "@/components/storageclasses/NodeFailureSim";
import { Chooser } from "@/components/storageclasses/Chooser";
import { YamlTabs, type YamlTab } from "@/components/storageclasses/YamlTabs";

export const metadata = pageMetadata("/storageclasses");

function TriBadge({ v, children }: { v: Tri; children: React.ReactNode }) {
  const c = v === "yes" ? "text-ok" : v === "no" ? "text-bad" : "text-warn";
  return (
    <span>
      <span className={`mr-1 font-mono ${c}`}>{v === "yes" ? "✓" : v === "no" ? "✗" : "~"}</span>
      {children}
    </span>
  );
}

function Dots({ n, invert }: { n: number; invert?: boolean }) {
  return (
    <span className="font-mono tracking-tight" aria-label={`${n} of 5`}>
      <span className={invert ? (n >= 4 ? "text-bad" : n >= 3 ? "text-warn" : "text-ok") : n >= 4 ? "text-ok" : n >= 3 ? "text-warn" : "text-bad"}>
        {"●".repeat(n)}
      </span>
      <span className="text-faint">{"○".repeat(5 - n)}</span>
    </span>
  );
}

const TALOS_HOSTPATH = `
# Talos machine-config patch: give the provisioner a bind mount the kubelet can see
machine:
  kubelet:
    extraMounts:
      - destination: /var/local-path-provisioner
        type: bind
        source: /var/local-path-provisioner
        options: [bind, rshared, rw]`;

const YAMLS: { id: string; label: string; color: string; note: React.ReactNode; yaml: string; talos?: string; talosTitle?: string }[] = [
  {
    id: "local-path",
    label: "local-path",
    color: "var(--color-f1)",
    note: (
      <>
        <span className="font-mono text-ink">WaitForFirstConsumer</span> is mandatory for local volumes: the scheduler must pick the
        node first, then the directory is created there. On Talos, <span className="font-mono text-ink">/var</span> is the EPHEMERAL
        partition, so data survives reboots but is wiped by a reset — consider a dedicated user volume for anything you care about.
      </>
    ),
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer`,
    talos: TALOS_HOSTPATH,
    talosTitle: "talos patch",
  },
  {
    id: "openebs-local",
    label: "openebs-local",
    color: "var(--color-f6)",
    note: "OpenEBS LocalPV hostpath is configured through annotations on the StorageClass. The LVM and ZFS engines use their own CSI drivers (local.csi.openebs.io, zfs.csi.openebs.io) and add snapshots and resizing.",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: openebs-hostpath
  annotations:
    openebs.io/cas-type: local
    cas.openebs.io/config: |
      - name: StorageType
        value: hostpath
      - name: BasePath
        value: /var/openebs/local
provisioner: openebs.io/local
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer`,
    talos: `
machine:
  kubelet:
    extraMounts:
      - destination: /var/openebs/local
        type: bind
        source: /var/openebs/local
        options: [bind, rshared, rw]`,
    talosTitle: "talos patch",
  },
  {
    id: "mayastor",
    label: "mayastor",
    color: "var(--color-f4)",
    note: "Replica count and transport are StorageClass parameters. Mayastor's io-engine needs hugepages and pins CPU cores, so budget for it on every storage node.",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: mayastor-3
provisioner: io.openebs.csi-mayastor
parameters:
  protocol: nvmf
  repl: "3"
  fsType: ext4
allowVolumeExpansion: true
volumeBindingMode: Immediate`,
    talos: `
machine:
  sysctls:
    vm.nr_hugepages: "1024"     # 1024 × 2 MiB = 2 GiB
  nodeLabels:
    openebs.io/engine: mayastor
  kubelet:
    extraMounts:
      - destination: /var/local
        type: bind
        source: /var/local
        options: [bind, rshared, rw]`,
    talosTitle: "talos patch (storage nodes)",
  },
  {
    id: "longhorn",
    label: "longhorn",
    color: "var(--color-f2)",
    note: (
      <>
        Longhorn attaches volumes over iSCSI, so Talos needs the <span className="font-mono text-ink">iscsi-tools</span> and{" "}
        <span className="font-mono text-ink">util-linux-tools</span> system extensions baked into the image (Image Factory schematic),
        plus an <span className="font-mono text-ink">rshared</span> bind mount for its data path.
      </>
    ),
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn-3r
provisioner: driver.longhorn.io
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "3"
  staleReplicaTimeout: "2880"
  dataLocality: best-effort
  fsType: ext4`,
    talos: `
# Image Factory schematic
customization:
  systemExtensions:
    officialExtensions:
      - siderolabs/iscsi-tools
      - siderolabs/util-linux-tools
---
# machine-config patch (default data path on EPHEMERAL; Longhorn's
# Talos >=1.10 guide uses a UserVolume at /var/mnt/longhorn instead)
machine:
  kubelet:
    extraMounts:
      - destination: /var/lib/longhorn
        type: bind
        source: /var/lib/longhorn
        options: [bind, rshared, rw]`,
    talosTitle: "schematic + talos patch",
  },
  {
    id: "rook-ceph",
    label: "rook-ceph",
    color: "var(--color-accent)",
    note: "Rook manages pools as CRDs; the StorageClass references the pool plus the CSI secrets Rook generates. Swap the provisioner for rook-ceph.cephfs.csi.ceph.com (with fsName) to get RWX.",
    yaml: `
apiVersion: ceph.rook.io/v1
kind: CephBlockPool
metadata:
  name: replicapool
  namespace: rook-ceph
spec:
  failureDomain: host
  replicated:
    size: 3
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-block
provisioner: rook-ceph.rbd.csi.ceph.com
parameters:
  clusterID: rook-ceph
  pool: replicapool
  imageFormat: "2"
  imageFeatures: layering
  csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
  csi.storage.k8s.io/controller-expand-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/controller-expand-secret-namespace: rook-ceph
  csi.storage.k8s.io/node-stage-secret-name: rook-csi-rbd-node
  csi.storage.k8s.io/node-stage-secret-namespace: rook-ceph
  csi.storage.k8s.io/fstype: ext4
reclaimPolicy: Delete
allowVolumeExpansion: true`,
  },
  {
    id: "ceph-external",
    label: "ceph (proxmox)",
    color: "var(--color-warn)",
    note: "Plain ceph-csi pointed at Proxmox's Ceph: create a dedicated pool and a restricted Ceph client on Proxmox, put its key in a Secret, and list the MONs in the ceph-csi config. clusterID is the Ceph fsid.",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: pve-ceph-rbd
provisioner: rbd.csi.ceph.com
parameters:
  clusterID: 5f1c…-ceph-fsid
  pool: k8s-rbd
  imageFeatures: layering
  csi.storage.k8s.io/provisioner-secret-name: csi-rbd-secret
  csi.storage.k8s.io/provisioner-secret-namespace: ceph-csi-rbd
  csi.storage.k8s.io/controller-expand-secret-name: csi-rbd-secret
  csi.storage.k8s.io/controller-expand-secret-namespace: ceph-csi-rbd
  csi.storage.k8s.io/node-stage-secret-name: csi-rbd-secret
  csi.storage.k8s.io/node-stage-secret-namespace: ceph-csi-rbd
  csi.storage.k8s.io/fstype: ext4
reclaimPolicy: Delete
allowVolumeExpansion: true`,
    talos: `
# on a Proxmox node: a pool and a least-privilege client for k8s
pveceph pool create k8s-rbd --application rbd
ceph auth get-or-create client.k8s \\
  mon 'profile rbd' osd 'profile rbd pool=k8s-rbd' mgr 'profile rbd pool=k8s-rbd'`,
    talosTitle: "proxmox side",
  },
  {
    id: "proxmox-csi",
    label: "proxmox-csi",
    color: "var(--color-accent-2)",
    note: (
      <>
        <span className="font-mono text-ink">storage</span> is a Proxmox storage ID. With local-lvm the PV gets the zone of the host it was
        created on; use <span className="font-mono text-ink">WaitForFirstConsumer</span> so it is created where the pod lands. Details on
        the <Link href="/proxmox-csi" className="text-accent hover:underline">Proxmox CSI page</Link>.
      </>
    ),
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: proxmox-lvm
provisioner: csi.proxmox.sinextra.dev
parameters:
  storage: local-lvm
  csi.storage.k8s.io/fstype: ext4
  cache: writethrough
  ssd: "true"
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer`,
  },
  {
    id: "nfs",
    label: "nfs",
    color: "var(--color-info)",
    note: "csi-driver-nfs creates one sub-directory per PV on an existing export. The older nfs-subdir-external-provisioner does the same without CSI (its provisioner name is whatever you configure).",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs
provisioner: nfs.csi.k8s.io
parameters:
  server: nas.lan
  share: /export/k8s
reclaimPolicy: Delete
volumeBindingMode: Immediate
mountOptions:
  - nfsvers=4.1
  - hard`,
  },
  {
    id: "democratic-csi",
    label: "democratic-csi",
    color: "var(--color-f3)",
    note: "democratic-csi runs one driver per mode (freenas-api-nfs, freenas-api-iscsi, …). The provisioner name is the csiDriver.name you set in the Helm values.",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: truenas-nfs
provisioner: org.democratic-csi.nfs
parameters:
  fsType: nfs
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: Immediate
mountOptions:
  - noatime
  - nfsvers=4`,
  },
  {
    id: "piraeus",
    label: "linstor",
    color: "var(--color-f5)",
    note: "placementCount is the number of DRBD replicas. Talos needs the DRBD extension in the image and the modules loaded with usermode_helper disabled.",
    yaml: `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: linstor-r2
provisioner: linstor.csi.linbit.com
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
parameters:
  linstor.csi.linbit.com/storagePool: pool1
  linstor.csi.linbit.com/placementCount: "2"
  csi.storage.k8s.io/fstype: ext4`,
    talos: `
# image needs siderolabs/drbd; then load the modules:
machine:
  kernel:
    modules:
      - name: drbd
        parameters:
          - usermode_helper=disabled
      - name: drbd_transport_tcp`,
    talosTitle: "talos patch",
  },
];

export default async function Page() {
  const tabs: YamlTab[] = await Promise.all(
    YAMLS.map(async (y) => ({
      id: y.id,
      label: y.label,
      color: y.color,
      note: y.note,
      code: await Code({ code: y.yaml, lang: "yaml", title: "storageclass.yaml" }),
      talos: y.talos ? await Code({ code: y.talos, lang: y.id === "ceph-external" ? "bash" : "yaml", title: y.talosTitle }) : undefined,
    })),
  );

  return (
    <>
      <PageHeader n="11" title="StorageClasses compared">
        A StorageClass is just a name for &ldquo;how to make a volume&rdquo;: a provisioner plus parameters. The real decision is what
        sits behind it — a directory on one node, a replicated block device, a Ceph cluster, a NAS, or a Proxmox virtual disk. That choice
        decides what happens on the worst day: when the node holding your data disappears.
      </PageHeader>

      <Section title="Kill a node, see who keeps their data" kicker="simulator">
        The pod <span className="font-mono text-ink">db-0</span> runs on <span className="font-mono text-ink">talos-w1</span> with a
        10 GiB volume. Pick a StorageClass, then pull the plug on w1.
      </Section>
      <NodeFailureSim />

      <Section title="Pick by requirements" kicker="chooser">
        Hard requirements remove options; preferences and what you already run reorder them. There is no universally best answer — mixing
        two classes (fast local for self-replicating databases, replicated for everything else) is normal.
      </Section>
      <Chooser />

      <Section title="The full matrix" kicker="compare">
        Performance and operational load are relative, 1–5. &ldquo;Talos needs&rdquo; is what you must add to an otherwise stock Talos
        image or machine config.
      </Section>
      <Matrix
        columns={["Replication / HA", "RWX", "Snapshots", "Perf", "Ops load", "Node failure", "Talos needs"]}
        rows={SCS.map((s) => ({
          label: (
            <span className="flex flex-col gap-1">
              <span className="text-ink">{s.short}</span>
              <Pill color={s.color} className="w-fit">
                {s.provisioner}
              </Pill>
            </span>
          ),
          cells: [
            <TriBadge key="r" v={s.survivesNodeLoss}>
              {s.replication}
            </TriBadge>,
            <TriBadge key="w" v={s.rwx}>
              {s.rwxNote}
            </TriBadge>,
            <TriBadge key="s" v={s.snapshots}>
              {s.snapNote}
            </TriBadge>,
            <span key="p" className="flex flex-col gap-1">
              <Dots n={s.perf} />
              <span className="text-[12px]">{s.perfNote}</span>
            </span>,
            <span key="o" className="flex flex-col gap-1">
              <Dots n={s.ops} invert />
              <span className="text-[12px]">{s.opsNote}</span>
            </span>,
            <span key="f">{s.failure}</span>,
            <span key="t" className="text-[12px]">
              {s.talos}
            </span>,
          ],
        }))}
      />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout tone="info" title="On Proxmox, consider storage below the VMs">
          If the hypervisor already has good storage (Ceph, ZFS, shared LVM), the cheapest HA story is often to <em>use</em> it — via{" "}
          <Link href="/proxmox-csi" className="text-accent hover:underline">
            Proxmox CSI
          </Link>{" "}
          or ceph-csi — instead of running a second replicated storage system inside the VMs, which replicates data that Proxmox
          already replicates.
        </Callout>
        <Callout tone="warn" title="Extensions are part of the image">
          Talos has no package manager. iscsi-tools, util-linux-tools, drbd or zfs must be in the installer image (Image Factory
          schematic), and adding one later means a <span className="font-mono text-ink">talosctl upgrade</span> to the new image on every
          node.
        </Callout>
      </div>

      <Section title="What the manifests look like" kicker="yaml">
        The provisioner string must match the CSI driver&apos;s registered name exactly — it is how Kubernetes finds the driver.
      </Section>
      <YamlTabs tabs={tabs} />

      <Panel title="Set a default" className="mt-4">
        <p className="mb-3 text-sm text-muted">
          PVCs without <span className="font-mono text-ink">storageClassName</span> get the class annotated as default. Have exactly one.
        </p>
        <Code
          lang="bash"
          code={`
kubectl get storageclass
kubectl patch storageclass longhorn-3r \\
  -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
kubectl get pv -o custom-columns=NAME:.metadata.name,CLASS:.spec.storageClassName,AFFINITY:.spec.nodeAffinity.required`}
        />
      </Panel>

      <Takeaways
        items={[
          "Local volumes (local-path, OpenEBS Local, Proxmox CSI on local-lvm) are fastest and simplest, but the PV is pinned: when the node dies, the pod waits. Use them for apps that replicate themselves.",
          "Replicated storage (Longhorn, Rook-Ceph, Mayastor, LINSTOR) lets the pod move — after Kubernetes is sure the old node let go. Budget CPU, RAM, network and your own time for it.",
          "On Talos every requirement is declarative: extensions in the image schematic, kubelet extraMounts and kernel modules in the machine config. Decide the storage stack before you build the image.",
        ]}
      />
    </>
  );
}
