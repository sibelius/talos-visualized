# Talos, visualized

An interactive Next.js site that teaches **Talos Linux** and the Kubernetes pieces around it — networking (CNIs), storage (CSI, StorageClasses) and the **Proxmox CCM & CSI** — with live diagrams and simulators.

Live: https://talos-visualized.vercel.app · Sister site: [Proxmox, visualized](https://github.com/sibelius/proxmox-visualized)

## Pages

| # | Page | What you can play with |
|---|------|------------------------|
| 01 | **An OS that is an API** | talosctl → apid → machined routing, disk layout, COSI resources |
| 02 | **Machine config** | Strategic-merge patches with a live merged YAML |
| 03 | **Bootstrap & etcd** | Cluster bring-up sequence, etcd quorum simulator, VIP & KubePrism |
| 04 | **Upgrades & Image Factory** | A/B upgrades with rollback, schematic builder for extensions |
| 05 | **Pod & Service networking** | Step through packets: pod↔pod, ClusterIP DNAT, DNS ndots, NodePort |
| 06 | **CNIs compared** | What a CNI does, encapsulation explorer (VXLAN/Geneve/IPIP/BGP/WireGuard), chooser |
| 07 | **Cilium & eBPF** | iptables vs eBPF maps, identities, Hubble flows, LB IPAM |
| 08 | **Network policies** | Toggle policies and watch allowed/denied edges recolor |
| 09 | **Services, LB & Gateway** | MetalLB/Cilium L2 & BGP, externalTrafficPolicy, Gateway API router |
| 10 | **PV, PVC & CSI** | The full CSI provisioning/attach/mount sequence, binding modes |
| 11 | **StorageClasses compared** | local-path, OpenEBS, Longhorn, Rook-Ceph, Proxmox CSI, NFS… + node-failure simulator |
| 12 | **Proxmox CCM** | Node initialization: providerID, topology labels, taint removal |
| 13 | **Proxmox CSI** | PVC → Proxmox disk → SCSI hot-plug → mount; zonal volumes |
| 14 | **Talos on Proxmox** | Step-by-step reference build with a growing architecture diagram |

## Run it

```bash
pnpm install
pnpm dev   # http://localhost:3102
```

Stack: Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Shiki. All diagrams are hand-drawn SVG + React state.
