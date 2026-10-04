import { Callout, Matrix, PageHeader, Panel, Pill, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { ApiPath } from "@/components/talos-os/ApiPath";
import { FixCompare } from "@/components/talos-os/FixCompare";
import { DiskLayout } from "@/components/talos-os/DiskLayout";
import { ResourceLoop } from "@/components/talos-os/ResourceLoop";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/talos-os");

const SERVICES: { name: string; where: string; what: string }[] = [
  { name: "machined", where: "PID 1, every node", what: "Replaces systemd and the whole userland. Runs services, holds the config, runs the COSI controllers that drive network, disks, time, etc." },
  { name: "apid", where: ":50000, every node", what: "The gRPC front door. Terminates mTLS, checks the role in your client cert, and proxies to other nodes' apid." },
  { name: "trustd", where: ":50001, control planes", what: "Issues certificates to other nodes (e.g. a worker's apid) after they prove they hold the cluster's machine token." },
  { name: "containerd", where: "every node", what: "Two instances: one for Talos system services, one (CRI) for the kubelet's pods." },
  { name: "kubelet", where: "every node", what: "Runs as a container managed by machined, configured from machine.kubelet." },
  { name: "etcd", where: "control planes", what: "Managed by machined, not by Kubernetes. Data lives on EPHEMERAL at /var/lib/etcd." },
  { name: "udevd, auditd, …", where: "every node", what: "A handful of small helpers. That's the whole list — there is no sshd, bash, or apt." },
];

export default async function Page() {
  return (
    <>
      <PageHeader n="01" title="An OS that is an API">
        Talos Linux is a Linux distribution with one job: run Kubernetes. It is immutable (the root filesystem is a read-only
        image), minimal (roughly a dozen binaries of its own), and has no SSH, no shell and no package manager. Every
        interaction, from reading a log to reconfiguring the network, is an authenticated gRPC call handled by{" "}
        <code className="font-mono text-ink">machined</code>, which runs as PID 1. You manage nodes the way you manage Kubernetes
        objects: declare, apply, let controllers converge.
      </PageHeader>

      <Panel title="talosctl → where does the call go?" right={<Pill color="var(--color-accent)">gRPC · mTLS · :50000</Pill>}>
        <ApiPath />
      </Panel>

      <Section title="The endpoint is not the node" kicker="-e vs -n">
        Your talosconfig lists <em>endpoints</em> (usually the control-plane IPs, or a load balancer). Commands go to an
        endpoint&apos;s apid, which proxies to the <em>nodes</em> you name with <code className="font-mono">-n</code>. That means
        workers don&apos;t need to be reachable from your laptop, and one command can fan out to many nodes, each reply
        tagged with its node. Authorization is in the client certificate: <code className="font-mono">os:admin</code>,{" "}
        <code className="font-mono">os:operator</code>, <code className="font-mono">os:reader</code>.
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Code
          title="~/.talos/config (talosconfig)"
          lang="yaml"
          code={`context: homelab
contexts:
  homelab:
    endpoints: [10.0.0.10, 10.0.0.11, 10.0.0.12]  # control planes
    nodes: [10.0.0.10]                            # default -n
    ca: LS0tLS1CRUdJTi...      # Talos API CA
    crt: LS0tLS1CRUdJTi...     # your client cert (role: os:admin)
    key: LS0tLS1CRUdJTi...`}
        />
        <Code
          title="everyday talosctl"
          code={`talosctl config endpoint 10.0.0.10 10.0.0.11 10.0.0.12
talosctl -n 10.0.0.21 dashboard          # live TUI
talosctl -n 10.0.0.21 services           # what machined runs
talosctl -n 10.0.0.21 logs kubelet -f
talosctl -n 10.0.0.21 dmesg
talosctl -n 10.0.0.21,10.0.0.22 get addresses
talosctl -n 10.0.0.21 read /proc/meminfo  # read-only file access
talosctl -n 10.0.0.21 pcap -i eth0        # packet capture, no tcpdump install`}
        />
      </div>

      <Section title="What actually runs on a node" kicker="the whole process list">
        On a traditional distro the OS is a pile of packages that Kubernetes happens to run on. On Talos the OS is a small,
        fixed set of services that exist only to run the kubelet and, on control planes, etcd.
      </Section>
      <Matrix
        columns={["where", "what it does"]}
        rows={SERVICES.map((s) => ({ label: <span className="font-mono text-ink">{s.name}</span>, cells: [s.where, s.what] }))}
      />

      <Section title="Fixing a node without logging into it" kicker="imperative vs declarative">
        The absence of SSH isn&apos;t a restriction you work around; it removes the most common source of drift. Every fix
        becomes a change to declared config (which you keep in git) or a new image, so the next node you build is identical.
      </Section>
      <Panel title="Same incident, two operating models">
        <FixCompare />
      </Panel>

      <Section title="Disk layout: one mutable partition" kicker="immutable by construction">
        Talos boots a SquashFS root image from its initramfs into memory, read-only. On disk there are only a few
        partitions with narrowly defined purposes, so you always know which bytes matter: the config in{" "}
        <code className="font-mono">STATE</code>, workload data in <code className="font-mono">EPHEMERAL</code>.
      </Section>
      <Panel title="Install disk & memory" right={<span className="text-[11px] text-faint">click a partition · pick an operation</span>}>
        <DiskLayout />
      </Panel>
      <div className="mt-4">
        <Callout title="GRUB vs systemd-boot">
          Older and BIOS installs use GRUB with A/B kernels on the <code className="font-mono">BOOT</code> partition. Since
          Talos 1.10, new installs on UEFI machines use systemd-boot, where each slot is a Unified Kernel Image (kernel +
          initramfs + cmdline, optionally signed for Secure Boot) on the EFI partition. The A/B idea is the same.
        </Callout>
      </div>

      <Section title="Everything is a resource" kicker="COSI: the Kubernetes model, inside the OS">
        machined is built on COSI (Common Operating System Interface): typed resources in namespaces, and controllers that
        watch some resources and write others. Specs describe what should be, statuses record what is. It&apos;s the same
        reconcile loop as a Kubernetes controller, which is why Talos self-heals instead of running scripts once at boot.
      </Section>
      <Panel title="A controller loop, one event at a time">
        <ResourceLoop />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="reading resources"
          code={`talosctl get rd                       # list every resource type
talosctl -n 10.0.0.21 get links
talosctl -n 10.0.0.21 get addresses
talosctl -n 10.0.0.21 get routes
talosctl -n 10.0.0.21 get members      # cluster membership (discovery)
talosctl -n 10.0.0.21 get machineconfig -o yaml
talosctl -n 10.0.0.21 get addresses --watch   # stream changes`}
        />
        <Code
          title="$ talosctl -n 10.0.0.21 get addresses"
          lang="text"
          code={`NODE        NAMESPACE   TYPE            ID                     VERSION   ADDRESS          LINK
10.0.0.21   network     AddressStatus   eth0/10.0.0.21/24      1         10.0.0.21/24     eth0
10.0.0.21   network     AddressStatus   eth0/fe80::be24:11/64  2         fe80::be24:11/64 eth0
10.0.0.21   network     AddressStatus   lo/127.0.0.1/8         1         127.0.0.1/8      lo
10.0.0.21   network     AddressStatus   cilium_host/10.244…    1         10.244.1.94/32   cilium_host`}
        />
      </div>

      <Takeaways
        items={[
          <span key="t1">There is no back door: the gRPC API is the only way in, so everything is authenticated, role-scoped and auditable, and a compromised workload has no shell to land in.</span>,
          <span key="t2">The read-only root and the narrow disk layout mean a node is fully described by its image version plus its machine config. Reproducing or replacing a node is routine.</span>,
          <span key="t3">COSI controllers continuously reconcile desired and actual state, so configuration is applied (and re-applied after drift) by the OS itself, not by an external tool.</span>,
        ]}
      />
    </>
  );
}
