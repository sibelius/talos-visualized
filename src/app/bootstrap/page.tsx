import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { BringUp } from "@/components/bootstrap/BringUp";
import { QuorumSim } from "@/components/bootstrap/QuorumSim";
import { EndpointOptions } from "@/components/bootstrap/EndpointOptions";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/bootstrap");

export default async function Page() {
  return (
    <>
      <PageHeader n="03" title="Bootstrap & etcd">
        Going from blank machines to a Kubernetes cluster on Talos takes three commands: apply a config to each node,
        bootstrap etcd on exactly one control plane, and fetch a kubeconfig. Everything in between (installing to disk,
        starting etcd, running the control-plane static pods, joining the other members) is done by machined on each node.
        This page walks through that sequence, then looks at the two things that decide whether the control plane stays
        up: etcd quorum and the API endpoint.
      </PageHeader>

      <Panel title="Cluster bring-up, step by step" right={<span className="text-[11px] text-faint">3 control planes · 2 workers</span>}>
        <BringUp />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="the whole bring-up"
          code={`# 1. nodes booted from ISO are in maintenance mode
talosctl get disks --insecure -n 10.0.0.10      # pick the install disk

# 2. push configs (unauthenticated, only possible in maintenance mode)
for ip in 10.0.0.10 10.0.0.11 10.0.0.12; do
  talosctl apply-config --insecure -n $ip -f controlplane.yaml
done
for ip in 10.0.0.21 10.0.0.22; do
  talosctl apply-config --insecure -n $ip -f worker.yaml
done

# 3. once, on one control plane
talosctl bootstrap -n 10.0.0.10 -e 10.0.0.10

# 4. wait for everything, then grab a kubeconfig
talosctl health -n 10.0.0.10
talosctl kubeconfig -n 10.0.0.10`}
        />
        <div className="space-y-4">
          <Callout tone="warn" title="Why bootstrap only once?">
            <code className="font-mono">talosctl bootstrap</code> tells a node to <em>create</em> a new etcd cluster rather than
            join one. The other control planes discover the existing cluster and join it automatically. Run bootstrap on a
            second node (or again after losing quorum) and you get a separate cluster. To recover a cluster that lost etcd,
            use <code className="font-mono">talosctl bootstrap --recover-from=db.snapshot</code> on one node instead.
          </Callout>
          <Code
            title="etcd, through the Talos API"
            code={`talosctl -n 10.0.0.10 etcd members
talosctl -n 10.0.0.10 etcd status
talosctl -n 10.0.0.10 etcd snapshot db.snapshot     # back this up!
talosctl -n 10.0.0.12 etcd leave                    # before removing a CP
talosctl -n 10.0.0.10 etcd remove-member <id>       # if it died for good`}
          />
        </div>
      </div>

      <Section title="etcd quorum: why 3 or 5, never 4" kicker="Raft majority">
        etcd is a Raft cluster: a write is committed only when a majority of members (⌊n/2⌋+1) has it. That majority is
        what keeps two halves of a partitioned cluster from both accepting writes. Adding a fourth member raises the quorum
        to 3 without tolerating any more failures, so even counts only add another thing that can break.
      </Section>
      <Panel title="Quorum simulator">
        <QuorumSim />
      </Panel>

      <Section title="One address for the API" kicker="cluster.controlPlane.endpoint">
        Every kubelet, every kubeconfig and every certificate refers to a single endpoint. It must keep working when any one
        control plane is down, so it can never be the IP of a single node. Talos gives you a built-in option (a shared
        VIP) and works with any external load balancer or DNS name. KubePrism then shields in-cluster clients from endpoint
        outages entirely.
      </Section>
      <Panel title="Endpoint options">
        <EndpointOptions />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="shared VIP (per control-plane patch)"
          lang="yaml"
          code={`machine:
  network:
    interfaces:
      - deviceSelector:
          physical: true
        dhcp: true
        vip:
          ip: 10.0.0.5        # unused IP on the same L2 segment
cluster:
  controlPlane:
    endpoint: https://10.0.0.5:6443`}
        />
        <Code
          title="KubePrism (default in generated configs)"
          lang="yaml"
          code={`machine:
  features:
    kubePrism:
      enabled: true
      port: 7445
# e.g. Cilium with kube-proxy replacement:
#   k8sServiceHost: localhost
#   k8sServicePort: 7445`}
        />
      </div>

      <Section title="How nodes find each other: discovery & KubeSpan" kicker="membership">
        Talos nodes publish small, encrypted &quot;affiliate&quot; records (hostname, addresses, role) to a discovery
        registry; by default that&apos;s the hosted service at <code className="font-mono">discovery.talos.dev</code>, which
        only ever sees encrypted blobs keyed by the cluster ID. That&apos;s what{" "}
        <code className="font-mono">talosctl get members</code> shows, and it&apos;s how KubePrism learns about every API
        server. You can self-host the service or disable it. KubeSpan builds on the same data: an optional full-mesh
        WireGuard network between all nodes, useful when nodes span sites or NATs.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code
          title="discovery + KubeSpan"
          lang="yaml"
          code={`cluster:
  discovery:
    enabled: true
    registries:
      service:
        endpoint: https://discovery.talos.dev/   # or your own
      kubernetes:
        disabled: true    # legacy registry using Node annotations
machine:
  network:
    kubespan:
      enabled: true       # WireGuard mesh between all members`}
        />
        <Code
          title="$ talosctl -n 10.0.0.10 get members"
          lang="text"
          code={`NODE        NAMESPACE   TYPE     ID         VERSION   HOSTNAME   MACHINE TYPE   OS               ADDRESSES
10.0.0.10   cluster     Member   cp-1       2         cp-1       controlplane   Talos (v1.11.3)  ["10.0.0.10"]
10.0.0.10   cluster     Member   cp-2       2         cp-2       controlplane   Talos (v1.11.3)  ["10.0.0.11"]
10.0.0.10   cluster     Member   cp-3       2         cp-3       controlplane   Talos (v1.11.3)  ["10.0.0.12"]
10.0.0.10   cluster     Member   worker-1   1         worker-1   worker         Talos (v1.11.3)  ["10.0.0.21"]
10.0.0.10   cluster     Member   worker-2   1         worker-2   worker         Talos (v1.11.3)  ["10.0.0.22"]`}
        />
      </div>

      <Takeaways
        items={[
          <span key="t1">Bootstrap is a one-time decision about where etcd is born. Everything else, including other control planes joining, is automatic and repeatable.</span>,
          <span key="t2">etcd availability is the control plane&apos;s availability: run 3 (or 5) members, replace a failed one before losing another, and take regular etcd snapshots.</span>,
          <span key="t3">Pick an endpoint that survives a node failure (VIP, LB or DNS), and keep KubePrism on so in-cluster components don&apos;t depend on it.</span>,
        ]}
      />
    </>
  );
}
