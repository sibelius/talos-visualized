import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { LifecycleDemo } from "@/components/storage/LifecycleDemo";
import { CsiComponents } from "@/components/storage/CsiComponents";
import { AccessModes, ReclaimDemo } from "@/components/storage/AccessModes";

export const metadata = pageMetadata("/storage");

const pvcYaml = `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: csi.proxmox.sinextra.dev   # = CSIDriver name; picks the driver
volumeBindingMode: WaitForFirstConsumer  # let the scheduler choose the node first
reclaimPolicy: Delete                    # or Retain
allowVolumeExpansion: true
parameters:                              # opaque to Kubernetes, passed to CreateVolume
  storage: local-lvm
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  storageClassName: fast
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 10Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "echo hi > /data/hello && sleep infinity"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data
`;

const debugCli = `
kubectl get pvc data -o wide                 # Pending? read the events:
kubectl describe pvc data                    # "waiting for first consumer", provisioning errors
kubectl get pv                               # the PV + its claim, reclaim policy, status
kubectl get pv <pv> -o jsonpath='{.spec.nodeAffinity}'   # where the volume can be used
kubectl get volumeattachments                # attach status per node
kubectl get csidrivers,csinodes              # which drivers are registered where
kubectl -n <csi-ns> logs deploy/<controller> -c csi-provisioner   # sidecar logs`;

const expandYaml = `
# StorageClass must have allowVolumeExpansion: true
kubectl patch pvc data -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'

# external-resizer -> ControllerExpandVolume (grow the backend disk)
# kubelet         -> NodeExpandVolume       (grow ext4/xfs, usually online)
kubectl get pvc data -o jsonpath='{.status.capacity.storage}'   # 20Gi when done`;

const snapYaml = `
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: csi-snap
driver: rook-ceph.rbd.csi.ceph.com   # must match the PV's driver
deletionPolicy: Delete
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: data-before-upgrade
spec:
  volumeSnapshotClassName: csi-snap
  source:
    persistentVolumeClaimName: data
---
# restore = a new PVC whose dataSource is the snapshot
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-restored
spec:
  storageClassName: ceph-block
  dataSource:
    apiGroup: snapshot.storage.k8s.io
    kind: VolumeSnapshot
    name: data-before-upgrade
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 10Gi } }`;

const stsYaml = `
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: pg
spec:
  serviceName: pg
  replicas: 3
  persistentVolumeClaimRetentionPolicy:   # default: Retain / Retain
    whenDeleted: Retain                   # keep PVCs if the StatefulSet is deleted
    whenScaled: Delete                    # drop pg-data-pg-2 when scaling 3 -> 2
  selector: { matchLabels: { app: pg } }
  template:
    metadata: { labels: { app: pg } }
    spec:
      containers:
        - name: pg
          image: postgres:17
          volumeMounts:
            - { name: pg-data, mountPath: /var/lib/postgresql/data }
  volumeClaimTemplates:                   # one PVC per replica: pg-data-pg-0, -1, -2
    - metadata: { name: pg-data }
      spec:
        storageClassName: fast
        accessModes: [ReadWriteOncePod]
        resources: { requests: { storage: 20Gi } }`;

const talosExtraMounts = `
# Talos machine config patch: let kubelet (a container) see a host path
# used by a hostPath-based provisioner such as local-path-provisioner
machine:
  kubelet:
    extraMounts:
      - destination: /var/local-path-provisioner
        type: bind
        source: /var/local-path-provisioner
        options: [bind, rshared, rw]`;

const talosUserVolume = `
# Talos 1.10+: carve a dedicated partition for workloads instead of sharing /var
apiVersion: v1alpha1
kind: UserVolumeConfig
name: local-storage            # mounted at /var/mnt/local-storage
provisioning:
  diskSelector:
    match: disk.transport == "nvme" && !system_disk
  minSize: 100GB
  maxSize: 500GB
filesystem:
  type: xfs`;

const talosCli = `
talosctl -n 10.0.0.21 get discoveredvolumes   # disks/partitions Talos sees
talosctl -n 10.0.0.21 get volumestatus        # EPHEMERAL, user volumes, their phase
talosctl -n 10.0.0.21 get mountstatus         # what is mounted where
talosctl -n 10.0.0.21 ls /var/mnt/local-storage`;

export default function Page() {
  return (
    <>
      <PageHeader n="10" title="PV, PVC & CSI">
        A <b className="text-ink">PersistentVolumeClaim</b> is a request (&quot;10Gi, one writer&quot;), a <b className="text-ink">PersistentVolume</b> is
        the volume that satisfies it, and a <b className="text-ink">StorageClass</b> says which driver creates volumes on demand. Since
        the in-tree volume plugins were removed, that driver is almost always a <b className="text-ink">CSI</b> driver: a set of
        containers that turn Kubernetes objects into gRPC calls like <code className="font-mono text-ink">CreateVolume</code> and{" "}
        <code className="font-mono text-ink">NodePublishVolume</code>. Once you know which component makes each call, a PVC stuck in
        Pending stops being a mystery.
      </PageHeader>

      <Section title="From claim to /data, one call at a time" kicker="demo 1 · lifecycle">
        Step through what happens between <code className="font-mono">kubectl apply</code> and your container seeing a mounted directory.
        Toggle the <b>volumeBindingMode</b>. With <code className="font-mono">Immediate</code> the disk is created before anyone knows
        where the pod will run. With <code className="font-mono">WaitForFirstConsumer</code> the scheduler picks the node first and the disk is created in
        that node&apos;s topology. Turn on the <code className="font-mono">nodeSelector</code> to see Immediate fail.
      </Section>
      <LifecycleDemo />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="storageclass + pvc + pod" code={pvcYaml} />
        <div className="space-y-4">
          <Code lang="bash" title="debugging a stuck volume" code={debugCli} />
          <Callout tone="warn" title="Why WaitForFirstConsumer is the right default">
            Any volume with topology, such as a disk on a specific Proxmox host, a node-local path, or a zonal cloud disk, should use{" "}
            <code className="font-mono">WaitForFirstConsumer</code>. Otherwise the volume&apos;s location silently overrides your pod&apos;s
            scheduling constraints. Immediate is only harmless for storage reachable from every node equally (Ceph RBD, NFS).
          </Callout>
        </div>
      </div>

      <Section title="Who is who in a CSI driver" kicker="demo 2 · components">
        CSI deliberately keeps the vendor&apos;s code free of Kubernetes. The driver only speaks gRPC on a unix socket. Kubernetes-aware{" "}
        <b>sidecars</b> maintained by sig-storage watch the API and translate. A driver ships as a <b>controller Deployment</b> (cluster-wide
        operations: create, attach, resize, snapshot) and a <b>node DaemonSet</b> (format and mount on each node), plus a{" "}
        <code className="font-mono">CSIDriver</code> object.
      </Section>
      <CsiComponents />

      <Section title="Access modes: the &quot;once&quot; is per node" kicker="demo 3 · access modes">
        Access modes describe how many <i>nodes</i> (or with RWOP, pods) may mount a volume at once, and they only mean something if the
        driver supports them. Switch the backend between a block disk and a shared filesystem.
      </Section>
      <AccessModes />

      <Section title="Reclaim policy: who owns the data after the claim is gone?" kicker="demo 4 · reclaim">
        The StorageClass&apos;s <code className="font-mono">reclaimPolicy</code> is copied onto every PV it provisions. Changing the class
        later doesn&apos;t touch existing PVs. Patch <code className="font-mono">persistentVolumeReclaimPolicy</code> on the PV itself
        to protect something important.
      </Section>
      <ReclaimDemo />

      <Section title="Day 2: grow, snapshot, replicate" kicker="expansion · snapshots · statefulsets">
        Volumes grow but never shrink. Snapshots are an add-on API: you need the{" "}
        <code className="font-mono">snapshot.storage.k8s.io/v1</code> CRDs and the snapshot-controller installed, plus a driver
        whose controller pod runs the csi-snapshotter sidecar. A StatefulSet&apos;s <code className="font-mono">volumeClaimTemplates</code>{" "}
        give each replica its own claim, and that claim follows the replica&apos;s stable name across restarts and reschedules.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Code lang="bash" title="online volume expansion" code={expandYaml} />
          <Code lang="yaml" title="statefulset with per-replica claims" code={stsYaml} />
        </div>
        <Code lang="yaml" title="snapshot + restore" code={snapYaml} />
      </div>

      <Section title="On Talos: where do bytes actually live?" kicker="talos specifics">
        Talos has no writable root filesystem. Everything stateful lives on the <b>EPHEMERAL</b> partition mounted at{" "}
        <code className="font-mono">/var</code>, where etcd, container images, kubelet state and any hostPath data sit side by side. It
        survives reboots but is wiped by <code className="font-mono">talosctl reset</code>, so it&apos;s node-scoped state, not durable storage.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Three things that bite on Talos">
          <ul className="space-y-3 text-[13px] leading-relaxed text-muted">
            <li>
              <b className="text-ink">kubelet runs in a container.</b> Host paths that hostPath-style provisioners use must also be mounted
              into kubelet via <code className="font-mono">machine.kubelet.extraMounts</code>, with <code className="font-mono">rshared</code>{" "}
              propagation. Otherwise the pod gets a directory that doesn&apos;t match what the provisioner created.
            </li>
            <li>
              <b className="text-ink">Filling /var hurts the node.</b> A runaway local-path volume competes with etcd and image storage on
              the same partition, and kubelet starts evicting pods under disk pressure. With Talos 1.10+ you can carve a separate
              partition with a <code className="font-mono">UserVolumeConfig</code> (mounted under{" "}
              <code className="font-mono">/var/mnt/&lt;name&gt;</code>, which Talos already mounts into kubelet, so no extraMounts needed for local-path) and point local storage there. You can also cap EPHEMERAL&apos;s size
              with a <code className="font-mono">VolumeConfig</code>.
            </li>
            <li>
              <b className="text-ink">Host tools come from extensions.</b> Drivers that shell out to iSCSI or block tools on the host need
              the matching Talos system extensions (e.g. <code className="font-mono">siderolabs/iscsi-tools</code>,{" "}
              <code className="font-mono">siderolabs/util-linux-tools</code>) baked into the image from Image Factory. See the StorageClasses page.
            </li>
          </ul>
        </Panel>
        <div className="space-y-4">
          <Code lang="yaml" title="machine config patch · kubelet extraMounts" code={talosExtraMounts} />
          <Code lang="yaml" title="machine config document · UserVolumeConfig" code={talosUserVolume} />
          <Code lang="bash" title="inspect volumes on a node" code={talosCli} />
        </div>
      </div>

      <Takeaways
        items={[
          <span key="t1">
            A PVC is only a request. The external-provisioner sidecar turns it into a real volume plus a PV, and kubelet (through the node
            plugin) turns that into a mount. When something is stuck, find which sidecar should be acting and read its logs and the PVC events.
          </span>,
          <span key="t2">
            Use <b className="text-ink">WaitForFirstConsumer</b> for anything with topology, which on Proxmox and bare metal is almost
            everything. Otherwise the disk is placed before the scheduler has a say, and pods end up unschedulable with &quot;volume node
            affinity conflict&quot;.
          </span>,
          <span key="t3">
            <b className="text-ink">RWO means one node, not one pod.</b> Use RWOP when you need a single writer. Choose{" "}
            <b className="text-ink">Retain</b> for data you can&apos;t recreate, because the default Delete removes the backend disk the moment
            the claim goes away.
          </span>,
        ]}
      />
    </>
  );
}
