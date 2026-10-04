import { Fragment } from "react";
import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { PacketWalk } from "@/components/k8snet/PacketWalk";
import { CidrMap, EndpointSliceDemo } from "@/components/k8snet/CidrMap";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/k8s-networking");

const talosNet = `# Talos machine config (cluster section) — these are the defaults
cluster:
  network:
    dnsDomain: cluster.local
    podSubnets:
      - 10.244.0.0/16      # split into per-node podCIDRs by kube-controller-manager
    serviceSubnets:
      - 10.96.0.0/12       # virtual IPs for Services; 10.96.0.10 = kube-dns
    cni:
      name: flannel        # VXLAN overlay by default
  controllerManager:
    extraArgs:
      node-cidr-mask-size-ipv4: "24"   # size of each node's block`;

const inspect = `# Which /24 did each node get?
kubectl get nodes -o custom-columns=NAME:.metadata.name,PODCIDR:.spec.podCIDR

# Who backs a Service right now?
kubectl get endpointslices -l kubernetes.io/service-name=api -o wide

# kube-proxy's rules on a node (Talos has no shell — ask kube-proxy itself)
kubectl -n kube-system exec ds/kube-proxy -- iptables-save -t nat | grep -A3 KUBE-SVC

# Watch the ndots search in action
kubectl run -it --rm dig --image=nicolaka/netshoot -- dig +search +showsearch api.example.com`;

const dnsFix = `apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"      # names with ≥2 dots go straight to upstream
  containers:
    - name: web
      image: ghcr.io/example/web:1.4`;

export default function Page() {
  return (
    <>
      <PageHeader n="05" title="Pod & Service networking">
        Kubernetes makes three promises: every pod gets its own IP, any pod can reach any other pod <b>without NAT</b>, and
        nodes can reach every pod. It doesn&apos;t implement them — the CNI plugin does (routes, veths, tunnels). Services
        then layer a <i>virtual</i> IP on top, translated on every node by kube-proxy (or eBPF). Step through a packet
        below and watch exactly which addresses get rewritten, and where.
      </PageHeader>

      <Panel title="Packet walk · two-node Talos cluster with Flannel" right={<span className="font-mono text-[11px] text-faint">changed fields flash</span>}>
        <PacketWalk />
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Callout tone="ok" title="Pod → pod: never NAT">
          Same node or cross node, overlay or routed: the source pod IP arrives intact. That&apos;s what makes pod IPs usable
          as identities for NetworkPolicy.
        </Callout>
        <Callout tone="info" title="Pod → Service: DNAT on the client node">
          A ClusterIP is a rule, not a host. The client&apos;s node picks an endpoint and rewrites the destination; conntrack
          reverses it on the reply.
        </Callout>
        <Callout tone="warn" title="External → NodePort: maybe SNAT">
          With <span className="font-mono">externalTrafficPolicy: Cluster</span> the node may forward to another node and
          must masquerade, hiding the client IP. <span className="font-mono">Local</span> keeps it.
        </Callout>
      </div>

      <Section title="Where the IPs come from" kicker="CIDRs">
        Talos defaults to <span className="font-mono">10.244.0.0/16</span> for pods and{" "}
        <span className="font-mono">10.96.0.0/12</span> for Services. kube-controller-manager carves the pod range into
        per-node blocks (a /24 by default → 256 nodes × 254 IPs). Drag the node count past the limit, or shrink the block
        size, and see what breaks. These ranges must not overlap your LAN or VPNs — and they&apos;re effectively permanent.
      </Section>
      <Panel title="podCIDR allocation">
        <CidrMap />
      </Panel>
      <div className="mt-4">
        <Code code={talosNet} lang="yaml" title="machine config patch · cluster.network" />
      </div>

      <Section title="EndpointSlices: the Service's live backend list" kicker="Service → pods">
        A Service&apos;s selector is evaluated continuously by the EndpointSlice controller, which writes the matching
        pods&apos; IPs and readiness into <span className="font-mono">EndpointSlice</span> objects (up to 100 endpoints
        each, so huge Services don&apos;t create one giant object). Every node&apos;s kube-proxy watches them and
        regenerates its rules. Fail a readiness probe and the pod drops out of rotation within seconds — without being
        killed.
      </Section>
      <Panel title="EndpointSlice → kube-proxy">
        <EndpointSliceDemo />
      </Panel>

      <Section title="The ndots:5 tax" kicker="DNS">
        Kubelet gives every pod <span className="font-mono">ndots:5</span> so short names like{" "}
        <span className="font-mono">api</span> or <span className="font-mono">api.payments</span> resolve through the
        search list. The side effect (replayed in the DNS scenario above): every external name with fewer than five dots
        burns three NXDOMAIN round-trips — times two for A and AAAA — before the real query. On chatty services that&apos;s
        most of CoreDNS&apos;s load.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code code={dnsFix} lang="yaml" title="per-pod: lower ndots (or use FQDNs with a trailing dot)" />
        <Code code={inspect} lang="bash" title="inspect it on a real cluster" />
      </div>

      <Takeaways
        items={[
          <Fragment key="1">
            Flat, NAT-free pod networking is what makes the rest possible: source IPs are meaningful, so policy, logs and
            observability can trust them. Overlay vs routed only changes how packets cross the underlay — not what pods see.
          </Fragment>,
          <Fragment key="2">
            Services are distributed DNAT. Each node holds rules for every Service (KUBE-SERVICES → KUBE-SVC → KUBE-SEP),
            the endpoint is chosen once per connection, and conntrack does the rest. Readiness, via EndpointSlices, decides
            who gets traffic.
          </Fragment>,
          <Fragment key="3">
            Pick your CIDRs before bootstrap: the pod and service ranges can&apos;t overlap anything you route to, the
            per-node block caps both node count and pods per node, and changing either later means rebuilding the cluster.
          </Fragment>,
        ]}
      />
    </>
  );
}
