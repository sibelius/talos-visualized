import { Fragment } from "react";
import { Callout, Matrix, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { CniAddFlow } from "@/components/cni/CniAddFlow";
import { EncapExplorer } from "@/components/cni/EncapExplorer";
import { CniChooser } from "@/components/cni/CniChooser";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/cni");

const flannel = `# Nothing to do: Talos deploys Flannel (VXLAN) out of the box.
# Optional tuning, e.g. pin the interface Flannel uses on multi-NIC nodes:
cluster:
  network:
    cni:
      name: flannel
      flannel:
        extraArgs:
          - --iface-can-reach=192.168.1.1`;

const noneCilium = `# patch: cni-none.yaml — apply to ALL control plane nodes before bootstrap
cluster:
  network:
    cni:
      name: none          # Talos installs no CNI; nodes stay NotReady until you do
  proxy:
    disabled: true        # Cilium replaces kube-proxy`;

const helmCilium = `helm repo add cilium https://helm.cilium.io && helm repo update

helm install cilium cilium/cilium --version 1.18.x --namespace kube-system \\
  --set ipam.mode=kubernetes \\
  --set kubeProxyReplacement=true \\
  --set securityContext.capabilities.ciliumAgent="{CHOWN,KILL,NET_ADMIN,NET_RAW,IPC_LOCK,SYS_ADMIN,SYS_RESOURCE,DAC_OVERRIDE,FOWNER,SETGID,SETUID}" \\
  --set securityContext.capabilities.cleanCiliumState="{NET_ADMIN,SYS_ADMIN,SYS_RESOURCE}" \\
  --set cgroup.autoMount.enabled=false \\
  --set cgroup.hostRoot=/sys/fs/cgroup \\
  --set k8sServiceHost=localhost \\
  --set k8sServicePort=7445`;

const calico = `# Talos: same cni.name: none patch (keep kube-proxy unless you use the eBPF dataplane)
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.30.x/manifests/tigera-operator.yaml

kubectl apply -f - <<'EOF'
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    linuxDataplane: Nftables        # or Iptables / BPF
    bgp: Enabled
    ipPools:
      - cidr: 10.244.0.0/16           # must match cluster.network.podSubnets
        encapsulation: VXLANCrossSubnet   # routed within a subnet, VXLAN across
        natOutgoing: Enabled
EOF`;

const Y = ({ children }: { children: React.ReactNode }) => <span className="text-ok">{children}</span>;
const N = ({ children }: { children: React.ReactNode }) => <span className="text-bad">{children}</span>;
const P = ({ children }: { children: React.ReactNode }) => <span className="text-warn">{children}</span>;

export default function Page() {
  return (
    <>
      <PageHeader n="06" title="CNIs compared">
        Kubernetes defines the network model but ships no implementation. A <b>CNI plugin</b> is the program the container
        runtime executes for every pod to wire it up: create the interface, give it an IP, make it routable. Everything else
        — tunnels vs BGP, iptables vs eBPF, NetworkPolicy, encryption — is the CNI&apos;s design choice. Talos ships Flannel;
        here&apos;s what it does, what the alternatives add, and how to swap.
      </PageHeader>

      <Panel title="What happens when a pod starts · the CNI contract">
        <CniAddFlow />
      </Panel>

      <Section title="Encapsulation, MTU and the bytes you pay" kicker="overlay vs routed">
        Pod IPs aren&apos;t known to your physical network, so a CNI either <b>tunnels</b> them inside node-to-node packets
        or <b>advertises</b> them to the routers (BGP). Tunnels cost header bytes on every packet and require a smaller
        pod MTU — get that wrong and you get the most confusing outage in networking.
      </Section>
      <Panel title="Encapsulation explorer">
        <EncapExplorer />
      </Panel>

      <Section title="The field" kicker="comparison">
        All of these implement the same CNI contract; they differ in dataplane, routing model and what they do beyond
        connectivity.
      </Section>
      <Matrix
        columns={["Flannel", "Cilium", "Calico", "Kube-router", "Kube-OVN", "Antrea", "Multus"]}
        rows={[
          { label: "Dataplane", cells: ["Linux bridge + routes", "eBPF", "iptables / nftables / eBPF", "routes + iptables + IPVS", "OVS (OVN)", "OVS", "meta-plugin (delegates)"] },
          { label: "Pod routing", cells: ["VXLAN, host-gw, WireGuard", "VXLAN / Geneve or native", "BGP native, IPIP, VXLAN", "BGP native (+IPIP)", "Geneve, VLAN underlay", "Geneve, VXLAN, noEncap", "whatever it delegates to"] },
          { label: "NetworkPolicy", cells: [<N key="f">none</N>, <Y key="c">L3/L4 + L7, identity-based</Y>, <Y key="ca">L3/L4, tiers, global</Y>, <Y key="k">L3/L4</Y>, <Y key="o">L3/L4</Y>, <Y key="a">L3/L4, tiers (+L7)</Y>, "—"] },
          { label: "kube-proxy replacement", cells: [<N key="f">no</N>, <Y key="c">full (eBPF)</Y>, <Y key="ca">eBPF dataplane</Y>, <Y key="k">IPVS proxy</Y>, <P key="o">partial</P>, <Y key="a">AntreaProxy</Y>, "—"] },
          { label: "Encryption", cells: [<P key="f">WireGuard backend</P>, <Y key="c">WireGuard, IPsec</Y>, <Y key="ca">WireGuard</Y>, <N key="k">no</N>, <P key="o">IPsec</P>, <Y key="a">IPsec, WireGuard</Y>, "—"] },
          { label: "BGP", cells: [<N key="f">no</N>, <Y key="c">BGP control plane</Y>, <Y key="ca">native, full mesh / RR</Y>, <Y key="k">GoBGP built in</Y>, <P key="o">LB/pod IP export</P>, <P key="a">BGP policy</P>, "—"] },
          { label: "Observability", cells: ["—", <Y key="c">Hubble (flows, L7, UI)</Y>, <P key="ca">flow logs, Whisker UI</P>, "—", <P key="o">mirroring, tracing</P>, <P key="a">Theia, traceflow</P>, "—"] },
          { label: "On Talos", cells: [<Y key="f">default, built in</Y>, "cni: none + Helm", "cni: none + operator", "cni: none + manifest", "cni: none + Helm", "cni: none + Helm", "add on top of primary"] },
        ]}
      />

      <Section title="Pick your CNI" kicker="chooser">
        Tick what you actually need. A missing hard requirement disqualifies an option; ties go to whatever does more of
        what you asked.
      </Section>
      <Panel title="Requirements → candidates">
        <CniChooser />
      </Panel>

      <Section title="Installing it on Talos" kicker="machine config">
        Talos owns the node, so the CNI choice lives in the machine config. Flannel needs nothing. For anything else, set{" "}
        <span className="font-mono">cluster.network.cni.name: none</span> before bootstrap; the nodes come up NotReady
        (no CNI config in <span className="font-mono">/etc/cni/net.d</span>) until you install one. With Cilium&apos;s kube-proxy
        replacement, also disable kube-proxy so two dataplanes don&apos;t fight over Services.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code code={flannel} lang="yaml" title="Flannel (default)" />
        <Code code={noneCilium} lang="yaml" title="Cilium · machine config patch" />
      </div>
      <div className="mt-4">
        <Code code={helmCilium} lang="bash" title="Cilium · Helm install with Talos-specific values" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Callout title="Why those values?">
          Talos mounts cgroup v2 itself, so Cilium must not (<span className="font-mono">cgroup.autoMount.enabled=false</span>,{" "}
          <span className="font-mono">hostRoot=/sys/fs/cgroup</span>). Talos doesn&apos;t allow the <span className="font-mono">SYS_MODULE</span>{" "}
          capability (kernel modules are baked in), hence the explicit capability lists.
        </Callout>
        <Callout title="Why localhost:7445?">
          Without kube-proxy there&apos;s no ClusterIP for <span className="font-mono">kubernetes.default</span> yet — Cilium is
          what would provide it. <b>KubePrism</b>, Talos&apos;s on-node API-server load balancer, listens on{" "}
          <span className="font-mono">localhost:7445</span> on every node, breaking the chicken-and-egg.
        </Callout>
        <Callout tone="warn" title="Bootstrap ordering">
          Helm can only run once the API is up, so nodes wait NotReady for a few minutes. To make it hands-off, render the
          chart with <span className="font-mono">helm template</span> into <span className="font-mono">cluster.inlineManifests</span>, or
          point <span className="font-mono">extraManifests</span> at a URL.
        </Callout>
      </div>
      <div className="mt-4">
        <Code code={calico} lang="bash" title="Calico · tigera operator" />
      </div>

      <Takeaways
        items={[
          <Fragment key="1">
            A CNI is a contract, not a product: runtime execs a binary with ADD/DEL, it builds a veth, asks IPAM for an IP,
            sets routes and returns JSON. Everything users notice — policy, encryption, Service speed — is extra.
          </Fragment>,
          <Fragment key="2">
            Overlay vs routed is a trade: tunnels work on any network but cost 20–60 bytes per packet and need a lower pod
            MTU; native routing is free but your fabric must learn pod routes (BGP or a flat L2).
          </Fragment>,
          <Fragment key="3">
            Flannel is a fine default until you need NetworkPolicy — it silently ignores policies. Choose the CNI before
            bootstrap; swapping a live cluster&apos;s dataplane is a migration, not a config change.
          </Fragment>,
        ]}
      />
    </>
  );
}
