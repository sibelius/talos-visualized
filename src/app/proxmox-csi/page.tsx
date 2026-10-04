import { Callout, Matrix, PageHeader, Pill, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { ProvisionDemo } from "@/components/proxmox-csi/ProvisionDemo";
import { MoveDemo } from "@/components/proxmox-csi/MoveDemo";

export const metadata = pageMetadata("/proxmox-csi");

const P = ({ c }: { c: string }) => <code className="font-mono text-[12px] text-ink">{c}</code>;
const ok = (k: string, t = "yes") => (
  <Pill key={k} color="var(--color-ok)">
    {t}
  </Pill>
);
const warn = (k: string, t: string) => (
  <Pill key={k} color="var(--color-warn)">
    {t}
  </Pill>
);

export default function Page() {
  return (
    <>
      <PageHeader n="13" title="Proxmox CSI">
        The{" "}
        <a className="text-accent hover:underline" href="https://github.com/sergelogvinov/proxmox-csi-plugin">
          Proxmox CSI plugin
        </a>{" "}
        (<code className="font-mono text-ink">csi.proxmox.sinextra.dev</code>) creates each PersistentVolume as an ordinary Proxmox virtual disk.
        The disk is allocated on a Proxmox storage pool and hot-plugged into the worker VM as an extra SCSI drive. No storage daemon runs inside
        Kubernetes. The data sits on the hypervisor, where Proxmox already manages it, and the plugin&apos;s job is to put it next to the right VM at
        the right time.
      </PageHeader>

      <Section title="Two halves, two levels of trust" kicker="architecture">
        The <strong className="text-ink">controller</strong> (a Deployment, usually on control planes) holds the Proxmox API token. It runs next to
        the standard sidecars: <code className="font-mono">csi-provisioner</code>, <code className="font-mono">csi-attacher</code>,{" "}
        <code className="font-mono">csi-resizer</code>, and optionally <code className="font-mono">csi-snapshotter</code>. It creates disks and
        attaches them to VMs. The <strong className="text-ink">node plugin</strong> (a DaemonSet in every worker VM) never talks to Proxmox. It only
        finds the new block device, formats it, and mounts it, which needs privileged access to the host. While a disk is unattached it is owned by
        a placeholder VM ID, <code className="font-mono">9999</code> (<code className="font-mono">features.controllerVMID</code>), which is why
        volumes are named <code className="font-mono">vm-9999-pvc-&lt;uuid&gt;</code>.
      </Section>

      <Section title="Demo 1: provisioning, end to end" kicker="CreateVolume → ControllerPublish → NodeStage → NodePublish">
        The StorageClass uses <code className="font-mono">WaitForFirstConsumer</code>, so nothing is created until the scheduler has picked a node.
        The disk then has to be allocated on <em>that node&apos;s</em> Proxmox host, because local LVM on pve1 is useless to a VM on pve2. Watch the
        VM config gain a <code className="font-mono">scsi1</code> line. The <code className="font-mono">wwn</code> the controller sets is how the
        node plugin finds the right <code className="font-mono">/dev/disk/by-id</code> entry. Switch to shared storage to see the PV&apos;s
        topology shrink to region only.
      </Section>
      <ProvisionDemo />

      <Section title="Demo 2: what if the pod moves?" kicker="topology in practice">
        Drain the node and send <code className="font-mono">pg-0</code> somewhere else. Within one Proxmox host the plugin detaches and re-attaches
        the disk for you. Across hosts, what happens depends on whether the storage is shared.
      </Section>
      <MoveDemo />

      <Section title="What's supported" kicker="feature status (per the project README & docs)" />
      <Matrix
        columns={["Status", "Notes"]}
        rows={[
          { label: "Dynamic provisioning + topology", cells: [ok("a"), "Needs topology.kubernetes.io/region on every node; zone is required for non-shared storage. Proxmox CCM sets both."] },
          { label: "Volume expansion", cells: [ok("b"), "allowVolumeExpansion: true. Grows the Proxmox disk on the attached VM, then the node plugin grows the filesystem."] },
          { label: "Storage capacity", cells: [ok("c"), "Publishes CSIStorageCapacity per region/zone so the scheduler avoids full pools (disable with options.enableCapacity: false)."] },
          { label: "Access modes", cells: [warn("d", "RWO only"), "Single-node modes only: a virtual disk is attached to one VM at a time."] },
          { label: "Encryption", cells: [ok("e"), "LUKS via csi.storage.k8s.io/node-stage-secret-* (secret key encryption-passphrase)."] },
          { label: "IOPS / bandwidth limits", cells: [ok("f"), "diskIOPS / diskMBps, also adjustable later through a VolumeAttributesClass."] },
          { label: "Snapshots & clones", cells: [warn("g", "experimental"), "Full copies, not deltas. Requires root@pam credentials and the snapshotter sidecar (controller.snapshotter.enabled)."] },
          { label: "Cross-host migration", cells: [warn("h", "offline, manual"), "pvecsictl migrate for local storage; automatic for shared storage."] },
          { label: "ZFS zone replication", cells: [ok("i"), "replicate / replicateSchedule / replicateZones (ZFS replication; needs the extended role)."] },
        ]}
      />

      <Section title="StorageClass parameters" kicker="docs/options.md">
        Everything under <code className="font-mono">parameters:</code> that the plugin understands. Unknown keys are not part of the documented
        surface, so don&apos;t guess.
      </Section>
      <Matrix
        columns={["Values", "Meaning"]}
        rows={[
          { label: <P c="storage" />, cells: ["Proxmox storage ID", "Which pool to allocate from (e.g. local-lvm, local-zfs, ceph-rbd). Required."] },
          { label: <P c="storageFormat" />, cells: ["raw | qcow2", "Disk format, where the storage type allows a choice."] },
          { label: <P c="csi.storage.k8s.io/fstype" />, cells: ["ext4 (default) | xfs", "Filesystem created by NodeStage on first use."] },
          { label: <P c="blockSize / inodeSize" />, cells: ['"4096" / "256"', "mkfs tuning."] },
          { label: <P c="cache" />, cells: ["directsync | none | writeback | writethrough", "QEMU cache mode of the attached drive."] },
          { label: <P c="ssd" />, cells: ['"true" | "false"', "SSD emulation, and turns discard on."] },
          { label: <P c="discard" />, cells: ["on | ignore", "TRIM/UNMAP pass-through, for when ssd would be inaccurate."] },
          { label: <P c="diskIOPS / diskMBps" />, cells: ['"4000" / "1000"', "Read+write limits on the QEMU drive."] },
          { label: <P c="replicate, replicateSchedule, replicateZones" />, cells: ['"true", "*/15", "pve-1,pve-3"', "ZFS replication to other zones."] },
          { label: <P c="backup" />, cells: ['"true" | "false"', "Include the disk in VM backups. The docs call it dangerous unless you understand restore."] },
          { label: <P c="csi.storage.k8s.io/node-stage-secret-*" />, cells: ["name / namespace", "Enables LUKS encryption (also set node-expand-secret-* to allow resizing)."] },
        ]}
      />

      <div className="mt-4">
        <Callout tone="warn" title="The SCSI controller matters">
          Volumes are attached as <code className="font-mono">scsiN</code> disks, so worker VMs need a VirtIO SCSI controller, and QEMU caps a VM at
          about 30 SCSI disks (the plugin defaults to 24 attachments per node). The CSI README suggests <em>VirtIO SCSI single</em>. Talos&apos;s
          Proxmox guide says to use plain <em>VirtIO SCSI</em> instead, because single can hang bootstrap, and the CSI FAQ fixes &quot;device
          /dev/disk/by-id/wwn-… is not found&quot; by switching to <code className="font-mono">virtio-scsi-pci</code>. On Talos, use{" "}
          <code className="font-mono">virtio-scsi-pci</code>.
        </Callout>
      </div>

      <Section title="Install on Talos" kicker="config" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Code
            title="Proxmox: role + user + token (docs/install.md)"
            lang="bash"
            code={`pveum role add CSI -privs "VM.Audit VM.Config.Disk Datastore.Allocate Datastore.AllocateSpace Datastore.Audit"
pveum user add kubernetes-csi@pve
pveum aclmod / -user kubernetes-csi@pve -role CSI
pveum user token add kubernetes-csi@pve csi -privsep 1
pveum aclmod / -tokens 'kubernetes-csi@pve!csi' -role CSI
# ZFS replication needs a broader role: see docs/install.md`}
          />
          <Code
            title="Namespace must allow privileged pods (Talos enforces Pod Security)"
            lang="bash"
            code={`kubectl create ns csi-proxmox
kubectl label ns csi-proxmox pod-security.kubernetes.io/enforce=privileged`}
          />
          <Code
            title="proxmox-csi.yaml (helm values)"
            lang="yaml"
            code={`config:
  clusters:
    - url: https://pve1.lan:8006/api2/json
      insecure: false
      token_id: "kubernetes-csi@pve!csi"
      token_secret: "<secret>"
      region: cluster-1          # must equal the CCM region label

storageClass:
  - name: proxmox-data
    storage: local-lvm
    reclaimPolicy: Delete
    fstype: xfs
    ssd: true
    annotations:
      storageclass.kubernetes.io/is-default-class: "true"

# controller next to the control plane
nodeSelector:
  node-role.kubernetes.io/control-plane: ""
tolerations:
  - key: node-role.kubernetes.io/control-plane
    effect: NoSchedule`}
          />
          <Code
            title="Install"
            lang="bash"
            code={`helm upgrade -i -n csi-proxmox -f proxmox-csi.yaml \\
  proxmox-csi-plugin oci://ghcr.io/sergelogvinov/charts/proxmox-csi-plugin

kubectl get csidriver csi.proxmox.sinextra.dev
kubectl get csistoragecapacities -A`}
          />
        </div>
        <div className="space-y-4">
          <Code
            title="The StorageClass it renders (or write it yourself)"
            lang="yaml"
            code={`apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: proxmox-data
provisioner: csi.proxmox.sinextra.dev
parameters:
  storage: local-lvm
  csi.storage.k8s.io/fstype: xfs
  ssd: "true"
  # cache: none
  # diskIOPS: "4000"
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer`}
          />
          <Code
            title="Test it"
            lang="yaml"
            code={`apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data-pg-0 }
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: proxmox-data
  resources: { requests: { storage: 10Gi } }
---
apiVersion: v1
kind: Pod
metadata: { name: pg-0 }
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "df -h /data && sleep 3600"]
      volumeMounts: [{ name: data, mountPath: /data }]
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: data-pg-0 }`}
          />
          <Code
            title="Grow it, move it"
            lang="bash"
            code={`# online expansion: Proxmox disk resize + filesystem grow
kubectl patch pvc data-pg-0 -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'

# move a local volume to another Proxmox host (offline, needs root@pam)
brew install sergelogvinov/tap/pvecsictl
pvecsictl migrate --config=cloud-config.yaml -n default data-pg-0 pve3 --force

# find orphaned vm-9999-pvc-* disks with no matching PV
pvecsictl clean --config=cloud-config.yaml local-lvm pve2`}
          />
          <Callout tone="info" title="Using Terraform for the VMs?">
            Add <code className="font-mono">lifecycle {"{ ignore_changes = [disk] }"}</code> to the VM resource. Otherwise the next{" "}
            <code className="font-mono">terraform apply</code> sees the CSI-attached <code className="font-mono">scsiN</code> disks as drift and
            detaches them.
          </Callout>
        </div>
      </div>

      <Takeaways
        items={[
          <span key="1">
            A PV is a Proxmox disk. Snapshots, backup and replication can stay at the hypervisor, and no storage daemon competes with your pods for
            RAM.
          </span>,
          <span key="2">
            <code className="font-mono text-ink">WaitForFirstConsumer</code> plus zone labels from the CCM put each disk on the same host as the VM
            that will use it. Without the labels, local storage can&apos;t work.
          </span>,
          <span key="3">
            Local storage is fast but pins a pod to one host, so plan replication at the app level (DB replicas spread by zone). Shared storage
            moves freely within the region.
          </span>,
        ]}
      />
    </>
  );
}
