import { Callout, Matrix, PageHeader, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { BuildStepper, type BuildStep } from "@/components/talos-on-proxmox/BuildStepper";
import { QuorumDemo } from "@/components/talos-on-proxmox/QuorumDemo";

export const metadata = pageMetadata("/talos-on-proxmox");

const c = (s: string) => <code className="font-mono text-ink">{s}</code>;

const STEPS: BuildStep[] = [
  {
    title: "Build an Image Factory schematic",
    tool: "factory.talos.dev",
    appears: "a schematic ID that names your exact image: Talos version + system extensions.",
    why: (
      <>
        Talos has no package manager, so anything extra is baked into the image as a system extension. On Proxmox you want{" "}
        {c("siderolabs/qemu-guest-agent")}, which lets Proxmox see IPs and shut VMs down cleanly. Add {c("siderolabs/iscsi-tools")} and{" "}
        {c("siderolabs/util-linux-tools")} only if you plan to run Longhorn. Proxmox CSI needs neither, because its disks arrive as plain SCSI
        devices. The same ID gives you both the boot ISO and the {c("installer")} image used for installs and upgrades.
      </>
    ),
  },
  {
    title: "Create the VMs (Terraform)",
    tool: "bpg/proxmox",
    appears: "6 VMs, one control plane and one worker per Proxmox host, booted into Talos maintenance mode.",
    why: (
      <>
        Talos&apos;s Proxmox guide recommends: {c("ovmf")} + {c("q35")} (with a 4M EFI disk), CPU type {c("host")} (Talos needs x86-64-v2),
        controller {c("VirtIO SCSI")} (<em>not</em> &quot;single&quot;, which can hang bootstrap), raw disk with discard/SSD on SSD storage, a{" "}
        {c("virtio")} NIC, the QEMU agent enabled, and <strong className="text-ink">ballooning and memory hotplug off</strong>. Size: 2+ cores /
        4 GB+ for control planes, 4+ cores / 8 GB+ for workers. Pin each VM to a host with {c("node_name")}. That is your anti-affinity.
      </>
    ),
  },
  {
    title: "Generate config + patches",
    tool: "talosctl gen config",
    appears: "controlplane.yaml / worker.yaml carrying a shared VIP, the factory installer, no CNI, no kube-proxy, external cloud provider.",
    why: (
      <>
        Patches keep the generated config pristine and your changes reviewable. A Layer-2 VIP floats between control planes, so the API endpoint
        survives losing one. {c("cni: none")} and {c("proxy.disabled")} leave room for Cilium. {c("externalCloudProvider")} makes the kubelets
        wait for the Proxmox CCM. Set each node&apos;s hostname to its VM name, because the CCM matches Nodes to VMs by name prefix plus SMBIOS
        UUID.
      </>
    ),
  },
  {
    title: "Apply & bootstrap etcd",
    tool: "talosctl",
    appears: "Talos installed to disk on all 6 VMs, etcd on the 3 control planes, VIP 10.0.0.10 answering. Nodes are NotReady because there is no CNI yet.",
    why: (
      <>
        {c("apply-config --insecure")} works only in maintenance mode, before the node has its PKI. {c("bootstrap")} is run{" "}
        <strong className="text-ink">once</strong>, against one control plane: it creates the etcd cluster that the other two join. Running it
        twice would create a second cluster.
      </>
    ),
  },
  {
    title: "Install Cilium",
    tool: "helm",
    appears: "Cilium agents on every node. Nodes go Ready but still carry the uninitialized taint, so ordinary pods stay Pending.",
    why: (
      <>
        With kube-proxy disabled, Cilium has to reach the API server without a Service IP. KubePrism, Talos&apos;s node-local API load balancer,
        answers on {c("localhost:7445")}. The capability and cgroup flags are required because Talos mounts cgroups itself and runs a hardened
        kernel.
      </>
    ),
  },
  {
    title: "Install Proxmox CCM",
    tool: "helm",
    appears: "providerID proxmox://cluster-1/<vmid>, region/zone/instance-type labels on every Node, uninitialized taint removed.",
    why: (
      <>
        This is where Kubernetes learns its physical layout: zone = Proxmox host. From now on, spread constraints and the CSI driver can reason
        about failure domains, and destroyed VMs clean up their own Node objects.
      </>
    ),
  },
  {
    title: "Install Proxmox CSI + StorageClass",
    tool: "helm",
    appears: "csi-proxmox namespace (privileged), controller on the control planes, a node plugin DaemonSet on every node, StorageClass proxmox-data.",
    why: (
      <>
        It needs a separate Proxmox token with disk privileges, and the same region name as the CCM. Talos enforces Pod Security, so the
        namespace has to be labelled privileged. Otherwise the node plugin, which formats and mounts block devices, is rejected.
      </>
    ),
  },
  {
    title: "Test with a PVC",
    tool: "kubectl",
    appears: "vm-9999-pvc-… on pve2's local-lvm, hot-plugged as scsi1 into worker-2.",
    why: (
      <>
        This proves the whole chain: scheduler → zone label → CreateVolume on the right host → hot-plug → mkfs → mount. If it sticks in Pending,
        check node labels first ({c("kubectl get nodes -L topology.kubernetes.io/zone")}), then the CSI controller logs.
      </>
    ),
  },
];

export default async function Page() {
  const snippets = [
    <Code
      key="1"
      title="schematic.yaml → schematic ID"
      lang="bash"
      code={`cat > schematic.yaml <<'EOF'
customization:
  systemExtensions:
    officialExtensions:
      - siderolabs/qemu-guest-agent
      # - siderolabs/iscsi-tools        # only for Longhorn
      # - siderolabs/util-linux-tools   # only for Longhorn
EOF
curl -X POST --data-binary @schematic.yaml https://factory.talos.dev/schematics
# {"id":"ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515"}   (qemu-guest-agent only)

# boot ISO      https://factory.talos.dev/image/<id>/<version>/metal-amd64.iso
# installer     factory.talos.dev/installer/<id>:<version>`}
    />,
    <Code
      key="2"
      title="main.tf (SKETCH: shape of the resources, not a drop-in module)"
      lang="hcl"
      code={`terraform {
  required_providers {
    proxmox = { source = "bpg/proxmox" }
    talos   = { source = "siderolabs/talos" }
  }
}

locals {
  nodes = {
    cp-1     = { host = "pve1", vmid = 101, cores = 2, mem = 4096 }
    cp-2     = { host = "pve2", vmid = 102, cores = 2, mem = 4096 }
    cp-3     = { host = "pve3", vmid = 103, cores = 2, mem = 4096 }
    worker-1 = { host = "pve1", vmid = 111, cores = 4, mem = 8192 }
    worker-2 = { host = "pve2", vmid = 112, cores = 4, mem = 8192 }
    worker-3 = { host = "pve3", vmid = 113, cores = 4, mem = 8192 }
  }
}

resource "proxmox_virtual_environment_vm" "talos" {
  for_each      = local.nodes
  name          = each.key            # = Talos hostname = k8s node name
  node_name     = each.value.host     # pins the VM to a Proxmox host
  vm_id         = each.value.vmid
  bios          = "ovmf"
  machine       = "q35"
  scsi_hardware = "virtio-scsi-pci"   # VirtIO SCSI, not "single"

  agent {
    enabled = true                    # needs the qemu-guest-agent extension
  }
  cpu {
    type  = "host"
    cores = each.value.cores
  }
  memory {
    dedicated = each.value.mem        # no ballooning / hotplug
  }
  efi_disk {
    datastore_id = "local-lvm"
    type         = "4m"
  }
  disk {
    datastore_id = "local-lvm"
    interface    = "scsi0"
    size         = 40
    file_format  = "raw"
    discard      = "on"
    ssd          = true
  }
  cdrom {
    file_id = "local:iso/talos-<id>-metal-amd64.iso"
  }
  network_device {
    bridge = "vmbr0"
    model  = "virtio"
  }
  operating_system {
    type = "l26"
  }

  lifecycle {
    ignore_changes = [disk]           # don't fight Proxmox CSI's hot-plugged scsiN disks
  }
}

# Then, with siderolabs/talos: talos_machine_secrets,
# data.talos_machine_configuration (+ config_patches from step 3),
# talos_machine_configuration_apply per node, talos_machine_bootstrap once,
# talos_cluster_kubeconfig.`}
    />,
    <Code
      key="3"
      title="patches + gen config"
      lang="yaml"
      code={`# common.yaml (all nodes)
machine:
  install:
    disk: /dev/sda               # check with: talosctl get disks --insecure -n <ip>
    image: factory.talos.dev/installer/<schematic-id>:<talos-version>
cluster:
  network:
    cni:
      name: none                 # Cilium comes in step 5
  proxy:
    disabled: true               # Cilium replaces kube-proxy
  externalCloudProvider:
    enabled: true                # kubelet --cloud-provider=external
---
# controlplane.yaml
machine:
  network:
    interfaces:
      - interface: eth0          # or deviceSelector: { physical: true }
        dhcp: true
        vip:
          ip: 10.0.0.10          # shared API endpoint
---
# per node, e.g. cp-1.yaml  (must match the VM name for the CCM)
machine:
  network:
    hostname: cp-1

# talosctl gen config homelab https://10.0.0.10:6443 \\
#   --config-patch @common.yaml \\
#   --config-patch-control-plane @controlplane.yaml \\
#   --output-dir _out`}
    />,
    <Code
      key="4"
      title="apply, bootstrap, kubeconfig"
      lang="bash"
      code={`# each control plane (in maintenance mode → --insecure)
talosctl apply-config --insecure -n 10.0.0.11 -f _out/controlplane.yaml --config-patch @cp-1.yaml
talosctl apply-config --insecure -n 10.0.0.12 -f _out/controlplane.yaml --config-patch @cp-2.yaml
talosctl apply-config --insecure -n 10.0.0.13 -f _out/controlplane.yaml --config-patch @cp-3.yaml
# each worker
talosctl apply-config --insecure -n 10.0.0.21 -f _out/worker.yaml --config-patch @worker-1.yaml
# …

export TALOSCONFIG=_out/talosconfig
talosctl config endpoint 10.0.0.11 10.0.0.12 10.0.0.13
talosctl bootstrap -n 10.0.0.11          # ONCE, one node
talosctl health -n 10.0.0.11
talosctl kubeconfig -n 10.0.0.11 .`}
    />,
    <Code
      key="5"
      title="Cilium without kube-proxy (from the Talos Cilium guide)"
      lang="bash"
      code={`helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium \\
  --namespace kube-system \\
  --set ipam.mode=kubernetes \\
  --set kubeProxyReplacement=true \\
  --set securityContext.capabilities.ciliumAgent="{CHOWN,KILL,NET_ADMIN,NET_RAW,IPC_LOCK,SYS_ADMIN,SYS_RESOURCE,DAC_OVERRIDE,FOWNER,SETGID,SETUID}" \\
  --set securityContext.capabilities.cleanCiliumState="{NET_ADMIN,SYS_ADMIN,SYS_RESOURCE}" \\
  --set cgroup.autoMount.enabled=false \\
  --set cgroup.hostRoot=/sys/fs/cgroup \\
  --set k8sServiceHost=localhost \\
  --set k8sServicePort=7445`}
    />,
    <Code
      key="6"
      title="Proxmox CCM"
      lang="bash"
      code={`# on a Proxmox host
pveum role add CCM -privs "VM.Audit VM.GuestAgent.Audit Sys.Audit"
pveum user add kubernetes@pve
pveum aclmod / -user kubernetes@pve -role CCM
pveum user token add kubernetes@pve ccm -privsep 0

# proxmox-ccm.yaml: config.clusters[0] = { url, token_id: kubernetes@pve!ccm, token_secret, region: cluster-1 }
helm upgrade -i -n kube-system -f proxmox-ccm.yaml proxmox-cloud-controller-manager \\
  oci://ghcr.io/sergelogvinov/charts/proxmox-cloud-controller-manager

kubectl get nodes -L topology.kubernetes.io/zone,node.kubernetes.io/instance-type`}
    />,
    <Code
      key="7"
      title="Proxmox CSI"
      lang="bash"
      code={`pveum role add CSI -privs "VM.Audit VM.Config.Disk Datastore.Allocate Datastore.AllocateSpace Datastore.Audit"
pveum user add kubernetes-csi@pve
pveum aclmod / -user kubernetes-csi@pve -role CSI
pveum user token add kubernetes-csi@pve csi -privsep 0

kubectl create ns csi-proxmox
kubectl label ns csi-proxmox pod-security.kubernetes.io/enforce=privileged

# proxmox-csi.yaml: config.clusters (region: cluster-1) + storageClass: [{ name: proxmox-data, storage: local-lvm, fstype: xfs, ssd: true }]
helm upgrade -i -n csi-proxmox -f proxmox-csi.yaml proxmox-csi-plugin \\
  oci://ghcr.io/sergelogvinov/charts/proxmox-csi-plugin`}
    />,
    <Code
      key="8"
      title="Smoke test"
      lang="bash"
      code={`kubectl apply -f https://raw.githubusercontent.com/sergelogvinov/proxmox-csi-plugin/main/docs/deploy/test-pod-ephemeral.yaml
#   (its ephemeral volume asks for storageClassName: proxmox — edit it to proxmox-data)
kubectl get pvc,pods -o wide
kubectl get pv -o jsonpath='{.items[0].spec.csi.volumeHandle}'
#   cluster-1/pve2/local-lvm/vm-9999-pvc-…
ssh root@pve2 qm config 112 | grep scsi
#   scsi1: local-lvm:vm-9999-pvc-…,…,wwn=0x…`}
    />,
  ];

  return (
    <>
      <PageHeader n="14" title="Talos on Proxmox">
        The last three pages explained the pieces separately. This one builds them into a single cluster: a 3-host Proxmox cluster running 3 Talos
        control planes and 3 workers, Cilium as the CNI, the Proxmox CCM supplying topology, and the Proxmox CSI plugin turning PVCs into
        hypervisor disks. Work through the checklist and watch the architecture fill in. Each step comes with the snippet you would actually run.
      </PageHeader>

      <BuildStepper steps={STEPS} snippets={snippets} />

      <Section title="The order matters" kicker="dependencies">
        Each step unblocks the next. Nodes are NotReady until a CNI runs. Ordinary pods stay off the nodes until the CCM removes the uninitialized
        taint, which is why the CCM chart and Cilium tolerate it. CSI can&apos;t place local volumes until nodes have zone labels.
      </Section>
      <Matrix
        columns={["Blocked until…", "Symptom if skipped"]}
        rows={[
          { label: "Cilium", cells: ["bootstrap (API reachable via KubePrism)", "Nodes NotReady, CoreDNS Pending"] },
          { label: "Proxmox CCM", cells: ["CNI up (or run it with useDaemonSet=true on hostNetwork)", "Pods Pending: untolerated taint node.cloudprovider.kubernetes.io/uninitialized"] },
          { label: "Proxmox CSI", cells: ["zone/region labels from the CCM", "CreateVolume fails: zone must be provided (local storage)"] },
          { label: "PVC", cells: ["StorageClass + node plugin registered (CSINode)", "PVC Pending forever under WaitForFirstConsumer"] },
        ]}
      />

      <Section title="Don't put all your etcd in one basket" kicker="anti-affinity">
        Three control planes only buy fault tolerance if they fail independently. Pick a placement, then power off Proxmox hosts.
      </Section>
      <QuorumDemo />

      <div className="mt-4">
        <Callout tone="info" title="Variations you'll meet">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              The <em>nocloud</em> image lets Proxmox&apos;s cloud-init drive hand Talos its IP and hostname, instead of DHCP plus per-node
              patches.
            </li>
            <li>
              Talos can carry the CCM, CSI and Cilium itself through {c("cluster.inlineManifests")} / {c("cluster.externalCloudProvider.manifests")}{" "}
              so a fresh cluster comes up complete without a post-bootstrap Helm step.
            </li>
            <li>
              For Ceph-backed Proxmox, point a second StorageClass at the RBD pool. Its volumes only pin the region, so pods can fail over across
              hosts.
            </li>
          </ul>
        </Callout>
      </div>

      <Takeaways
        items={[
          <span key="1">
            Every layer comes from a declaration: an Image Factory schematic, Terraform VMs and Talos patches. You can rebuild the cluster from Git
            instead of from memory.
          </span>,
          <span key="2">
            Pin VMs to Proxmox hosts on purpose: one control plane per host for etcd quorum, and stable zones for the CCM labels and local CSI
            disks.
          </span>,
          <span key="3">
            CCM before CSI. Topology labels are the contract between Kubernetes and Proxmox, and storage placement depends on them.
          </span>,
        ]}
      />
    </>
  );
}
