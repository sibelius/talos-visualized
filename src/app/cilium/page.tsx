import { Fragment } from "react";
import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { ScaleCompare } from "@/components/cilium/ScaleCompare";
import { HookStack, SocketLB } from "@/components/cilium/SocketLB";
import { IdentityHubble } from "@/components/cilium/IdentityHubble";
import { LbAnnounce } from "@/components/cilium/LbAnnounce";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/cilium");

const policy = `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: backend, namespace: shop }
spec:
  endpointSelector: { matchLabels: { app: backend } }
  ingress:
    - fromEndpoints: [{ matchLabels: { app: frontend } }]
      toPorts:
        - ports: [{ port: "8080", protocol: TCP }]
          rules:
            http: [{ method: GET, path: "/api/.*" }]   # L7, via Envoy`;

const values = `# cilium-values.yaml — Talos (cluster.network.cni.name: none, cluster.proxy.disabled: true)
ipam:
  mode: kubernetes                 # use node.spec.podCIDR from Talos' podSubnets
kubeProxyReplacement: true
k8sServiceHost: localhost          # KubePrism: Talos' local API LB on every node
k8sServicePort: 7445
securityContext:
  capabilities:
    ciliumAgent: [CHOWN, KILL, NET_ADMIN, NET_RAW, IPC_LOCK, SYS_ADMIN, SYS_RESOURCE, DAC_OVERRIDE, FOWNER, SETGID, SETUID]
    cleanCiliumState: [NET_ADMIN, SYS_ADMIN, SYS_RESOURCE]
cgroup:
  autoMount: { enabled: false }    # Talos already mounts cgroup v2
  hostRoot: /sys/fs/cgroup

# optional extras
routingMode: tunnel                # or "native" + autoDirectNodeRoutes / BGP
tunnelProtocol: vxlan
bpf:
  masquerade: true
l2announcements:
  enabled: true                    # LB IPs on a flat LAN (homelab / Proxmox)
bgpControlPlane:
  enabled: false                   # or peer with your ToR instead
hubble:
  relay: { enabled: true }
  ui: { enabled: true }
encryption:
  enabled: false
  type: wireguard
gatewayAPI:
  enabled: false                   # needs the Gateway API CRDs installed first`;

const helm = `helm install cilium cilium/cilium --version 1.18.x -n kube-system -f cilium-values.yaml

cilium status --wait                       # agents, operator, KPR mode
cilium connectivity test                   # end-to-end conformance checks
kubectl -n kube-system exec ds/cilium -- cilium-dbg service list   # the eBPF service map
cilium hubble port-forward & hubble observe -n shop --verdict DROPPED`;

const lb = `apiVersion: cilium.io/v2
kind: CiliumLoadBalancerIPPool
metadata: { name: lan }
spec:
  blocks:
    - start: 192.168.1.240
      stop: 192.168.1.250
---
apiVersion: cilium.io/v2alpha1
kind: CiliumL2AnnouncementPolicy
metadata: { name: lan }
spec:
  loadBalancerIPs: true
  interfaces: ["^eth[0-9]+", "^ens.*"]
  nodeSelector:
    matchExpressions:
      - { key: node-role.kubernetes.io/control-plane, operator: DoesNotExist }`;

const bgp = `# BGP control plane (v2 API; older releases used cilium.io/v2alpha1)
apiVersion: cilium.io/v2
kind: CiliumBGPClusterConfig
metadata: { name: tor }
spec:
  nodeSelector: { matchLabels: { bgp: "true" } }
  bgpInstances:
    - name: main
      localASN: 65001
      peers:
        - name: tor
          peerASN: 65000
          peerAddress: 192.168.1.1
          peerConfigRef: { name: tor }
# + CiliumBGPPeerConfig (timers, families) and
#   CiliumBGPAdvertisement { advertisementType: Service, service.addresses: [LoadBalancerIP] }`;

export default function Page() {
  return (
    <>
      <PageHeader n="07" title="Cilium & eBPF">
        eBPF lets you load small, verified programs into the running Linux kernel and attach them to hooks — sockets, the
        traffic-control layer, the NIC driver. Cilium uses that to replace kube-proxy&apos;s iptables chains with hash-map
        lookups, to load-balance at <span className="font-mono">connect()</span> instead of per packet, and to enforce policy
        on <i>workload identity</i> rather than IP addresses. All of it ships as a DaemonSet; no kernel modules — which is
        exactly what an immutable OS like Talos wants.
      </PageHeader>

      <Panel title="iptables vs eBPF · Service lookup at scale">
        <ScaleCompare />
      </Panel>

      <Section title="Load-balance once, at the socket" kicker="socket LB">
        kube-proxy translates the ClusterIP on every packet. Cilium hooks the <span className="font-mono">connect()</span>{" "}
        syscall itself: the socket is pointed at a real backend before the first byte is sent.
      </Section>
      <Panel title="Per-packet NAT vs socket-level load balancing">
        <SocketLB />
      </Panel>

      <Section title="Where the programs attach" kicker="hooks">
        Different traffic is handled at different depths of the stack. The earlier the hook, the less work the kernel does —
        XDP runs in the NIC driver before the kernel has even allocated a packet buffer, which is why it&apos;s used to
        accelerate NodePort/LoadBalancer traffic and drop floods cheaply.
      </Section>
      <Panel title="The eBPF hook points Cilium uses">
        <HookStack />
      </Panel>

      <Section title="Identity, not IPs — and Hubble to watch it" kicker="policy + observability">
        Pod IPs churn constantly, so IP-based firewall rules are always out of date. Cilium hashes each pod&apos;s relevant
        labels into a numeric <b>security identity</b>, shared cluster-wide. Policy maps on every node are keyed on
        identities; packets carry the source identity (in the tunnel header, or resolved from the IP cache). Scale a
        Deployment and the new pods reuse the identity — nothing recompiles. Hubble taps the same datapath and records every
        flow with its verdict.
      </Section>
      <Panel title="Security identities → policy verdicts → Hubble flow log">
        <IdentityHubble policyCode={<Code code={policy} lang="yaml" title="the policy for backend (frontend may GET /api/* on 8080)" />} />
      </Panel>

      <Section title="LoadBalancer Services without a cloud" kicker="LB IPAM · L2 · BGP">
        On bare metal or Proxmox nobody hands out LoadBalancer IPs. Cilium can do it itself: <b>LB IPAM</b> assigns addresses
        from a pool, and either <b>L2 announcements</b> (ARP from a lease-holding node) or the <b>BGP control plane</b>{" "}
        (advertise /32s to your router) makes them reachable — replacing MetalLB.
      </Section>
      <Panel title="Announcing 192.168.1.240">
        <LbAnnounce />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code code={lb} lang="yaml" title="LB IPAM pool + L2 announcement policy" />
        <Code code={bgp} lang="yaml" title="…or BGP to a ToR router" />
      </div>

      <Section title="Beyond one cluster, beyond networking" kicker="ecosystem" />
      <div className="grid gap-4 md:grid-cols-2">
        <Callout title="Cluster Mesh">
          Connects multiple clusters&apos; Cilium control planes (each exposes a <span className="font-mono">clustermesh-apiserver</span>).
          Pods get cross-cluster connectivity, identities are shared so policies can reference remote workloads, and a{" "}
          <span className="font-mono">service.cilium.io/global: &quot;true&quot;</span> annotation load-balances a Service across
          clusters for failover. Requires non-overlapping pod CIDRs and unique cluster IDs — plan this before you bootstrap.
        </Callout>
        <Callout title="Tetragon">
          A sibling project using the same eBPF machinery for <b>runtime security</b>: it observes process execution, file
          access, and syscalls with full Kubernetes context, and can enforce in-kernel (e.g. kill a process that opens{" "}
          <span className="font-mono">/etc/shadow</span>) via <span className="font-mono">TracingPolicy</span> resources.
          Installed separately with its own Helm chart.
        </Callout>
      </div>

      <Section title="Installing on Talos" kicker="helm values">
        The Talos-specific parts are the top block: let Talos own cgroups and kernel modules, reach the API via KubePrism, and
        take Pod CIDRs from the Kubernetes node objects. The rest is feature toggles.
      </Section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Code code={values} lang="yaml" title="cilium-values.yaml" />
        <div className="space-y-4">
          <Code code={helm} lang="bash" title="install & verify" />
          <Callout tone="warn" title="Kernel & capabilities">
            Talos ships a recent kernel with the eBPF features Cilium needs, but forbids loading kernel modules — that&apos;s why
            the default <span className="font-mono">SYS_MODULE</span> capability is removed from the agent&apos;s list.
          </Callout>
        </div>
      </div>

      <Takeaways
        items={[
          <Fragment key="1">
            eBPF swaps O(n) iptables chains for O(1) map lookups and moves Service translation to the socket, so load
            balancing costs one rewrite per connection instead of two per packet — and stays flat at thousands of Services.
          </Fragment>,
          <Fragment key="2">
            Identity-based policy survives pod churn: labels map to a numeric identity, policy is enforced on identities, and
            scaling or rescheduling pods doesn&apos;t touch any rules. Hubble shows you each verdict as it happens.
          </Fragment>,
          <Fragment key="3">
            On Talos, Cilium is a natural fit: set <span className="font-mono">cni: none</span> and disable kube-proxy, point it
            at KubePrism, and you also get LoadBalancer IPs (L2 or BGP), encryption and Gateway API without extra components.
          </Fragment>,
        ]}
      />
    </>
  );
}
