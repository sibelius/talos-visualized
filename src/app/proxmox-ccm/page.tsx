import { Callout, Matrix, PageHeader, Pill, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { NodeInitDemo } from "@/components/proxmox-ccm/NodeInitDemo";
import { LifecycleDemo } from "@/components/proxmox-ccm/LifecycleDemo";
import { SpreadDemo } from "@/components/proxmox-ccm/SpreadDemo";

export const metadata = pageMetadata("/proxmox-ccm");

const yes = (k: string) => <Pill key={k} color="var(--color-ok)">implemented</Pill>;
const no = <Pill color="var(--color-faint)">not implemented</Pill>;

export default function Page() {
  return (
    <>
      <PageHeader n="12" title="Proxmox CCM">
        A Kubernetes Node object starts out knowing nothing about the machine underneath it. It doesn&apos;t know which Proxmox VM it is, which
        physical host that VM runs on, or whether the VM still exists. The{" "}
        <a className="text-accent hover:underline" href="https://github.com/sergelogvinov/proxmox-cloud-controller-manager">
          Proxmox cloud-controller-manager
        </a>{" "}
        fills that in. It matches each Node to its VM, writes a <code className="font-mono text-ink">providerID</code> and topology labels, and
        deletes the Node when the VM is destroyed.
      </PageHeader>

      <Section title="What a cloud-controller-manager is" kicker="background">
        Kubernetes used to ship AWS, GCE, OpenStack and other cloud code inside <code className="font-mono">kube-controller-manager</code> and the
        kubelet. That code was moved out into a separate binary, the cloud-controller-manager, built on the{" "}
        <code className="font-mono">k8s.io/cloud-provider</code> framework. A provider implements a small Go interface, and the framework runs the
        controllers that use it. The Proxmox CCM implements only <code className="font-mono">InstancesV2</code>, so only the two node controllers
        have anything to do:
      </Section>

      <Matrix
        columns={["What it does", "Proxmox CCM"]}
        rows={[
          { label: "cloud-node", cells: ["Initializes new Nodes: providerID, addresses, instance-type and zone/region labels, then removes the uninitialized taint", yes("a")] },
          { label: "cloud-node-lifecycle", cells: ["Watches NotReady Nodes: deletes them when the instance is gone, taints them when it is shut down", yes("b")] },
          { label: "route", cells: ["Programs cloud routes for pod CIDRs", <span key="r">{no} <span className="text-faint">— your CNI (Cilium) handles pod routing</span></span>] },
          { label: "service", cells: ["Creates cloud load balancers for type: LoadBalancer", <span key="s">{no} <span className="text-faint">— use Cilium LB-IPAM / L2, MetalLB or kube-vip</span></span>] },
        ]}
      />

      <Section title="Demo 1: a VM joins the cluster" kicker="cloud-node controller">
        Pick a worker and play the sequence. With <code className="font-mono">--cloud-provider=external</code> the kubelet registers the Node with
        a <code className="font-mono">NoSchedule</code> taint, which keeps ordinary pods off it until the CCM has filled in the details. Turn the
        flag off to see what happens when that handshake is missing.
      </Section>
      <NodeInitDemo />

      <Section title="Demo 2: the VM goes away" kicker="cloud-node-lifecycle controller">
        The lifecycle controller only checks Nodes that are no longer Ready, and asks the CCM two questions. Does the instance still exist? Is it
        shut down? Try a graceful shutdown, a destroy, and a whole Proxmox host going dark.
      </Section>
      <LifecycleDemo />

      <Section title="Demo 3: why topology labels are worth the trouble" kicker="region & zone">
        The CCM maps <code className="font-mono">topology.kubernetes.io/region</code> to the Proxmox cluster (the <code className="font-mono">region</code>{" "}
        key in its config) and <code className="font-mono">topology.kubernetes.io/zone</code> to the Proxmox host the VM runs on. Several things read
        those labels: topology spread constraints and anti-affinity, so HA replicas don&apos;t share a power supply; the Proxmox CSI plugin, so a
        volume on a host&apos;s local LVM is only attached to VMs on that host; and anything else that reasons about failure domains.
      </Section>
      <SpreadDemo />

      <div className="mt-4">
        <Callout tone="warn" title="Labels are set once">
          The cloud-provider framework writes labels at initialization and doesn&apos;t update them afterwards. If you live-migrate a VM to another
          Proxmox host, its <code className="font-mono">zone</code> label is now wrong, and the project&apos;s FAQ answers &quot;does CCM support
          online VM migration?&quot; with &quot;No&quot;. Treat VMs as fixed to a host. Drain and recreate them instead of migrating. CPU type{" "}
          <code className="font-mono">host</code>, which Talos recommends, also rules out live migration between different CPUs.
        </Callout>
      </div>

      <Section title="Setting it up" kicker="config">
        You need four things: a Proxmox API token with read-only VM access, a config file listing your Proxmox cluster(s), the CCM itself, and
        kubelets running with <code className="font-mono">--cloud-provider=external</code>.
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Code
            title="On a Proxmox host: role, user, token (from the project's docs/install.md)"
            lang="bash"
            code={`# Read-only: audit VMs, ask the guest agent, read cluster status
pveum role add CCM -privs "VM.Audit VM.GuestAgent.Audit Sys.Audit"
pveum user add kubernetes@pve
pveum aclmod / -user kubernetes@pve -role CCM
pveum user token add kubernetes@pve ccm -privsep 0
# → prints the token secret once; token_id is kubernetes@pve!ccm`}
          />
          <Code
            title="proxmox-ccm.yaml (helm values)"
            lang="yaml"
            code={`config:
  clusters:
    - url: https://pve1.lan:8006/api2/json
      insecure: false          # true only for self-signed certs in a lab
      token_id: "kubernetes@pve!ccm"
      token_secret: "<secret>"
      region: cluster-1        # becomes topology.kubernetes.io/region
    # more Proxmox clusters → more regions, one Kubernetes cluster

# enabledControllers defaults to cloud-node + cloud-node-lifecycle`}
          />
          <Code
            title="Install (OCI helm chart)"
            lang="bash"
            code={`helm upgrade -i --namespace=kube-system -f proxmox-ccm.yaml \\
  proxmox-cloud-controller-manager \\
  oci://ghcr.io/sergelogvinov/charts/proxmox-cloud-controller-manager

# DaemonSet mode uses hostNetwork, so it can run before a CNI exists:
#   --set useDaemonSet=true  (pin it to control planes with nodeSelector)`}
          />
        </div>
        <div className="space-y-4">
          <Code
            title="Talos machine config patch (all nodes)"
            lang="yaml"
            code={`cluster:
  externalCloudProvider:
    enabled: true   # Talos then runs kubelet with --cloud-provider=external
machine:
  kubelet:
    extraArgs:
      cloud-provider: external   # redundant with the above, but explicit`}
          />
          <Code
            title="Or ship it with the machine config (from the CSI docs)"
            lang="yaml"
            code={`cluster:
  inlineManifests:
    - name: proxmox-cloud-controller-manager
      contents: |-
        apiVersion: v1
        kind: Secret
        type: Opaque
        metadata:
          name: proxmox-cloud-controller-manager
          namespace: kube-system
        stringData:
          config.yaml: |
            clusters:
              - url: https://pve1.lan:8006/api2/json
                insecure: false
                token_id: "kubernetes@pve!ccm"
                token_secret: "<secret>"
                region: cluster-1
  externalCloudProvider:
    enabled: true
    manifests:
      - https://raw.githubusercontent.com/sergelogvinov/proxmox-cloud-controller-manager/main/docs/deploy/cloud-controller-manager.yml`}
          />
          <Code
            title="Verify"
            lang="bash"
            code={`kubectl get nodes -L topology.kubernetes.io/region,topology.kubernetes.io/zone,node.kubernetes.io/instance-type
kubectl get node worker-3 -o jsonpath='{.spec.providerID}'   # proxmox://cluster-1/113
kubectl describe node worker-3 | grep Taints                 # no uninitialized taint`}
          />
        </div>
      </div>

      <div className="mt-4">
        <Callout tone="info" title="Things that trip people up">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              The VM name must <em>start with</em> the Kubernetes node name, and the SMBIOS UUID must match. If you rename one side, the match fails.
            </li>
            <li>
              The flag has to be present when the kubelet first registers. If you add it later, delete the Node object and restart the kubelet.
            </li>
            <li>
              By default addresses come from the kubelet&apos;s <code className="font-mono">--node-ip</code>. Set{" "}
              <code className="font-mono">features.network.mode: qemu</code> or <code className="font-mono">auto</code> to read them from the QEMU guest
              agent instead, which needs the <code className="font-mono">qemu-guest-agent</code> Talos extension.
            </li>
          </ul>
        </Callout>
      </div>

      <Takeaways
        items={[
          <span key="t1">
            The CCM gives each Node a durable identity, <code className="font-mono text-ink">proxmox://region/vmid</code>, so Kubernetes and Proxmox
            agree on which VM is which.
          </span>,
          <span key="t2">
            <code className="font-mono text-ink">zone</code> = Proxmox host. That one label is what lets the scheduler keep HA replicas off the same
            physical box, and what lets the CSI driver keep local disks next to their VM.
          </span>,
          <span key="t3">
            When you <code className="font-mono text-ink">terraform destroy</code> a VM, its Node is cleaned up automatically. A stopped VM keeps its Node
            with a shutdown taint, and an unreachable host isn&apos;t treated as proof that the VM is gone.
          </span>,
        ]}
      />
    </>
  );
}
