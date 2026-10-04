export type ScId =
  | "local-path"
  | "openebs-local"
  | "mayastor"
  | "longhorn"
  | "rook-ceph"
  | "ceph-external"
  | "proxmox-csi"
  | "nfs"
  | "democratic-csi"
  | "piraeus";

/** "yes" / "no" / "partial" (true with a caveat) */
export type Tri = "yes" | "no" | "partial";

export type ScInfo = {
  id: ScId;
  name: string;
  short: string;
  provisioner: string;
  color: string;
  /** what it actually is, one line */
  what: string;
  survivesNodeLoss: Tri;
  rwx: Tri;
  snapshots: Tri;
  objectS3: boolean;
  /** 1 (slow) .. 5 (local-NVMe class) */
  perf: number;
  /** 1 (install & forget) .. 5 (you are now a storage team) */
  ops: number;
  replication: string;
  rwxNote: string;
  snapNote: string;
  perfNote: string;
  opsNote: string;
  failure: string;
  talos: string;
  /** context that has to be true for this option to make sense */
  needs?: "proxmox" | "pveCeph" | "nas";
};

export const SCS: ScInfo[] = [
  {
    id: "local-path",
    name: "local-path-provisioner",
    short: "local-path",
    provisioner: "rancher.io/local-path",
    color: "var(--color-f1)",
    what: "Rancher's tiny provisioner: each PV is a directory on the node that first runs the pod.",
    survivesNodeLoss: "no",
    rwx: "no",
    snapshots: "no",
    objectS3: false,
    perf: 5,
    ops: 1,
    replication: "None — one copy on one node",
    rwxNote: "No (RWO, effectively one node)",
    snapNote: "No",
    perfNote: "Raw node disk, no network hop",
    opsNote: "One Deployment + ConfigMap",
    failure: "PV has nodeAffinity → pod is stuck Pending until that node comes back",
    talos: "kubelet extraMounts for /var/local-path-provisioner, or point it at a user volume under /var/mnt (already visible to kubelet) — /var is the EPHEMERAL partition",
  },
  {
    id: "openebs-local",
    name: "OpenEBS LocalPV (hostpath / LVM / ZFS)",
    short: "OpenEBS Local",
    provisioner: "openebs.io/local",
    color: "var(--color-f6)",
    what: "Node-local volumes like local-path, with LVM or ZFS flavours that add quotas, snapshots and resize.",
    survivesNodeLoss: "no",
    rwx: "no",
    snapshots: "partial",
    objectS3: false,
    perf: 5,
    ops: 2,
    replication: "None (rely on app-level replication)",
    rwxNote: "No",
    snapNote: "LVM / ZFS flavours only",
    perfNote: "Local disk speed",
    opsNote: "Small; LVM/ZFS need a VG / pool prepared per node",
    failure: "Pinned to the node — stuck until it returns",
    talos: "hostpath: extraMounts for /var/openebs/local. ZFS: siderolabs/zfs extension. LVM: a VG on a spare disk",
  },
  {
    id: "mayastor",
    name: "OpenEBS Replicated PV Mayastor",
    short: "Mayastor",
    provisioner: "io.openebs.csi-mayastor",
    color: "var(--color-f4)",
    what: "SPDK-based replicated block storage exported over NVMe-oF/TCP. Built for NVMe speed.",
    survivesNodeLoss: "yes",
    rwx: "no",
    snapshots: "yes",
    objectS3: false,
    perf: 5,
    ops: 4,
    replication: "Synchronous N replicas (repl: \"3\")",
    rwxNote: "No (block / RWO)",
    snapNote: "Yes",
    perfNote: "NVMe-oF, polling cores — very fast, but burns dedicated CPU",
    opsNote: "Hugepages, dedicated cores, disk pools per node",
    failure: "Pod reschedules; a surviving replica keeps serving",
    talos: "2 MiB hugepages (vm.nr_hugepages sysctl), nvme-tcp kernel support, node label openebs.io/engine=mayastor, privileged namespace",
  },
  {
    id: "longhorn",
    name: "Longhorn",
    short: "Longhorn",
    provisioner: "driver.longhorn.io",
    color: "var(--color-f2)",
    what: "CNCF replicated block storage: a per-volume engine on the pod's node, replicas on other nodes, attached over iSCSI.",
    survivesNodeLoss: "yes",
    rwx: "yes",
    snapshots: "yes",
    objectS3: false,
    perf: 3,
    ops: 3,
    replication: "Synchronous replicas per volume (numberOfReplicas)",
    rwxNote: "Yes — via an NFSv4 share-manager pod",
    snapNote: "Yes + built-in backups to S3/NFS",
    perfNote: "Good; replication + iSCSI hop costs latency",
    opsNote: "Nice UI; watch disk space & rebuild traffic",
    failure: "Pod reschedules and attaches a surviving replica; volume runs degraded until rebuilt",
    talos: "siderolabs/iscsi-tools + siderolabs/util-linux-tools extensions, kubelet extraMounts (rshared) for the data path — /var/lib/longhorn, or /var/mnt/longhorn on a UserVolume (Talos 1.10+) — privileged namespace",
  },
  {
    id: "rook-ceph",
    name: "Rook-Ceph",
    short: "Rook-Ceph",
    provisioner: "rook-ceph.rbd.csi.ceph.com",
    color: "var(--color-accent)",
    what: "An operator that runs a full Ceph cluster inside Kubernetes: RBD block, CephFS (RWX) and RGW (S3).",
    survivesNodeLoss: "yes",
    rwx: "yes",
    snapshots: "yes",
    objectS3: true,
    perf: 4,
    ops: 5,
    replication: "CRUSH-placed replicas (size 3) or erasure coding",
    rwxNote: "Yes — CephFS (rook-ceph.cephfs.csi.ceph.com)",
    snapNote: "Yes, plus clones",
    perfNote: "Scales out well; needs fast network (10G+) and RAM",
    opsNote: "Highest: MONs, OSDs, MGRs, PG health, upgrades",
    failure: "Pod reschedules anywhere; Ceph serves from the other replicas and recovers",
    talos: "Dedicated raw disks/partitions for OSDs (no extension needed — rbd/ceph kernel modules ship with Talos), privileged namespace, ≥3 nodes",
  },
  {
    id: "ceph-external",
    name: "Ceph CSI → Proxmox's Ceph",
    short: "Ceph (Proxmox)",
    provisioner: "rbd.csi.ceph.com",
    color: "var(--color-warn)",
    what: "Plain ceph-csi (or Rook in external mode) pointed at the Ceph cluster your Proxmox hosts already run.",
    survivesNodeLoss: "yes",
    rwx: "yes",
    snapshots: "yes",
    objectS3: false,
    perf: 4,
    ops: 2,
    replication: "Ceph replicas on the Proxmox hosts",
    rwxNote: "Yes if CephFS (an MDS) is set up on Proxmox",
    snapNote: "Yes",
    perfNote: "Same as your Proxmox Ceph; Talos VMs need a route to the Ceph public network",
    opsNote: "Kubernetes side is just the CSI driver; Ceph is run by Proxmox",
    failure: "Pod reschedules anywhere; data lives outside the k8s cluster",
    talos: "No extension. Network reachability to the Ceph MONs, a Ceph client key/user per cluster",
    needs: "pveCeph",
  },
  {
    id: "proxmox-csi",
    name: "Proxmox CSI plugin",
    short: "Proxmox CSI",
    provisioner: "csi.proxmox.sinextra.dev",
    color: "var(--color-accent-2)",
    what: "Creates each PV as a Proxmox virtual disk (via the Proxmox API) and hot-plugs it into the Talos VM.",
    survivesNodeLoss: "partial",
    rwx: "no",
    snapshots: "partial",
    objectS3: false,
    perf: 4,
    ops: 1,
    replication: "Whatever the Proxmox storage does (none for local-lvm, Ceph for RBD)",
    rwxNote: "No (a disk attaches to one VM)",
    snapNote: "Experimental: full-copy snapshots, needs root@pam — Proxmox backups are the safer bet",
    perfNote: "Native virtio disk; as fast as the backing storage",
    opsNote: "Low: a Proxmox API token + topology labels",
    failure: "Local storage: stuck in that host's zone. Shared storage: disk can be attached to a VM on another host",
    talos: "No extension. Nodes need topology.kubernetes.io/region & zone labels (Proxmox/Talos CCM)",
    needs: "proxmox",
  },
  {
    id: "nfs",
    name: "csi-driver-nfs / nfs-subdir",
    short: "NFS",
    provisioner: "nfs.csi.k8s.io",
    color: "var(--color-info)",
    what: "Each PV is a sub-directory on an existing NFS export.",
    survivesNodeLoss: "partial",
    rwx: "yes",
    snapshots: "partial",
    objectS3: false,
    perf: 2,
    ops: 1,
    replication: "None in k8s — the NAS is a single point of failure unless it is HA",
    rwxNote: "Yes — the classic RWX answer",
    snapNote: "csi-driver-nfs: tar-archive snapshots (v4.3+); subdir: none",
    perfNote: "Network FS; poor for databases (fsync, locking)",
    opsNote: "Trivial if a NAS already exists",
    failure: "Pod reschedules anywhere; NAS outage = all volumes down",
    talos: "No extension — the kubelet does the NFS mount",
    needs: "nas",
  },
  {
    id: "democratic-csi",
    name: "democratic-csi (TrueNAS)",
    short: "democratic-csi",
    provisioner: "org.democratic-csi.nfs",
    color: "var(--color-f3)",
    what: "Drives TrueNAS / ZFS over its API: creates a dataset or zvol per PV, exported via NFS, iSCSI or NVMe-oF.",
    survivesNodeLoss: "partial",
    rwx: "yes",
    snapshots: "yes",
    objectS3: false,
    perf: 3,
    ops: 2,
    replication: "ZFS RAID inside the NAS; NAS itself is one box",
    rwxNote: "Yes with the NFS driver; RWO with iSCSI/NVMe-oF",
    snapNote: "Yes — real ZFS snapshots",
    perfNote: "Decent; iSCSI zvols beat NFS for databases",
    opsNote: "One Helm release per driver mode; NAS API key",
    failure: "Pod reschedules anywhere; NAS outage = all volumes down",
    talos: "NFS mode: nothing. iSCSI mode: siderolabs/iscsi-tools extension",
    needs: "nas",
  },
  {
    id: "piraeus",
    name: "Piraeus / LINSTOR (DRBD)",
    short: "LINSTOR",
    provisioner: "linstor.csi.linbit.com",
    color: "var(--color-f5)",
    what: "LINSTOR orchestrates DRBD: kernel-level synchronous block replication between nodes.",
    survivesNodeLoss: "yes",
    rwx: "no",
    snapshots: "yes",
    objectS3: false,
    perf: 5,
    ops: 4,
    replication: "DRBD synchronous replicas (placementCount) + diskless tiebreaker",
    rwxNote: "No (block / RWO)",
    snapNote: "Yes with LVM-thin / ZFS pools",
    perfNote: "Near-local: reads can be served by the local replica",
    opsNote: "Kernel module, satellites, quorum concepts",
    failure: "Pod reschedules; DRBD promotes a surviving replica",
    talos: "siderolabs/drbd extension + load drbd (usermode_helper=disabled) and drbd_transport_tcp modules",
  },
];

export const byId = Object.fromEntries(SCS.map((s) => [s.id, s])) as Record<ScId, ScInfo>;
