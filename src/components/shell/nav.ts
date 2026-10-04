export type NavItem = { href: string; label: string; blurb: string; n: string; group: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", blurb: "Talos + Kubernetes on one page", n: "00", group: "Start" },
  { href: "/talos-os", label: "An OS that is an API", blurb: "No SSH, no shell, just machined", n: "01", group: "Talos" },
  { href: "/machine-config", label: "Machine config", blurb: "One YAML, patches, secrets", n: "02", group: "Talos" },
  { href: "/bootstrap", label: "Bootstrap & etcd", blurb: "From ISO to a quorate control plane", n: "03", group: "Talos" },
  { href: "/upgrades", label: "Upgrades & Image Factory", blurb: "A/B images and system extensions", n: "04", group: "Talos" },
  { href: "/k8s-networking", label: "Pod & Service networking", blurb: "Follow a packet through the cluster", n: "05", group: "Networking" },
  { href: "/cni", label: "CNIs compared", blurb: "Flannel, Cilium, Calico & more", n: "06", group: "Networking" },
  { href: "/cilium", label: "Cilium & eBPF", blurb: "kube-proxy replacement, Hubble", n: "07", group: "Networking" },
  { href: "/network-policy", label: "Network policies", blurb: "Who can talk to whom", n: "08", group: "Networking" },
  { href: "/load-balancing", label: "Services, LB & Gateway", blurb: "ClusterIP to Gateway API", n: "09", group: "Networking" },
  { href: "/storage", label: "PV, PVC & CSI", blurb: "How a claim becomes a disk", n: "10", group: "Storage" },
  { href: "/storageclasses", label: "StorageClasses compared", blurb: "local-path, Longhorn, Rook-Ceph…", n: "11", group: "Storage" },
  { href: "/proxmox-ccm", label: "Proxmox CCM", blurb: "Nodes that know their VM", n: "12", group: "Proxmox" },
  { href: "/proxmox-csi", label: "Proxmox CSI", blurb: "PVCs as Proxmox virtual disks", n: "13", group: "Proxmox" },
  { href: "/talos-on-proxmox", label: "Talos on Proxmox", blurb: "The full reference build", n: "14", group: "Proxmox" },
];
