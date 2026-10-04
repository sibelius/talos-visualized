import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { pageMetadata } from "@/lib/og";
import { PolicySimulator } from "@/components/netpol/PolicySimulator";
import { SelectorGotcha } from "@/components/netpol/SelectorGotcha";
import { TierStack } from "@/components/netpol/TierStack";

export const metadata = pageMetadata("/network-policy");

const DEFAULT_DENY = `
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: shop
spec:
  podSelector: {}                 # all pods in the namespace
  policyTypes: [Ingress, Egress]  # isolate both directions, allow nothing
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: shop
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - {protocol: UDP, port: 53}
    - {protocol: TCP, port: 53}
`;

const TEST = `
# list what's in force
kubectl get networkpolicy -A
kubectl describe networkpolicy -n shop allow-frontend-to-api

# probe from a throwaway pod that carries the frontend's labels
kubectl run probe -n shop --rm -it --restart=Never \\
  --labels app=frontend --image=busybox:1.36 -- \\
  sh -c 'nslookup api.shop.svc.cluster.local && wget -qO- -T 2 http://api:8080/healthz'

# with Cilium + Hubble: watch the drops live, with the reason
hubble observe --namespace shop --verdict DROPPED --follow
`;

const ANP = `
apiVersion: policy.networking.k8s.io/v1alpha1
kind: AdminNetworkPolicy
metadata:
  name: always-allow-monitoring
spec:
  priority: 10                      # lower number = evaluated first
  subject:
    namespaces: {}                  # applies to every namespace
  ingress:
  - name: prometheus-scrapes-everything
    action: Allow                   # tenants can't block it
    from:
    - pods:
        namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: monitoring
        podSelector:
          matchLabels:
            app: prometheus
---
apiVersion: policy.networking.k8s.io/v1alpha1
kind: BaselineAdminNetworkPolicy
metadata:
  name: default                     # singleton
spec:
  subject:
    namespaces:
      matchLabels:
        tenant: "true"
  ingress:
  - name: deny-cross-namespace-by-default
    action: Deny                    # applies only where no NetworkPolicy decides
    from:
    - namespaces: {}
`;

const CILIUM = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api
  namespace: shop
spec:
  endpointSelector:
    matchLabels: {app: api}
  ingress:
  - fromEndpoints:
    - matchLabels: {app: frontend}
    toPorts:
    - ports: [{port: "8080", protocol: TCP}]
      rules:
        http:                       # L7: only these requests pass
        - method: GET
          path: "/products.*"
        - method: POST
          path: "/orders"
  egress:
  - toEndpoints:                    # DNS, and let Cilium's proxy see the lookups
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: kube-system
        k8s-app: kube-dns
    toPorts:
    - ports: [{port: "53", protocol: ANY}]
      rules:
        dns:
        - matchPattern: "*"
  - toFQDNs:                        # egress by hostname, not IP
    - matchName: api.stripe.com
    toPorts:
    - ports: [{port: "443", protocol: TCP}]
`;

const CALICO = `
apiVersion: projectcalico.org/v3
kind: GlobalNetworkPolicy
metadata:
  name: deny-metadata-and-smtp
spec:
  order: 100                        # explicit ordering, explicit Deny
  selector: all()
  types: [Egress]
  egress:
  - action: Deny
    protocol: TCP
    destination:
      ports: [25]
  - action: Deny
    destination:
      nets: [169.254.169.254/32]
  - action: Pass                    # hand over to namespaced policies
`;

const TALOS_CNI = `
# Talos ships Flannel by default — it does NOT enforce NetworkPolicy.
# Disable it (and kube-proxy, if Cilium replaces it) and install a policy-capable CNI.
cluster:
  network:
    cni:
      name: none
  proxy:
    disabled: true
`;

export default function Page() {
  return (
    <>
      <PageHeader n="08" title="Network policies">
        By default every pod can talk to every other pod, in every namespace, and to the internet. A NetworkPolicy is a namespaced
        <b className="text-ink"> allow-list</b>: the moment a policy selects a pod for a direction, that pod is isolated in that
        direction and only what some policy explicitly allows gets through. The API server only stores them — your{" "}
        <b className="text-ink">CNI enforces them</b>, in eBPF or iptables on each node.
      </PageHeader>

      <PolicySimulator />

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Callout tone="info" title="Additive, never subtractive">
          Policies can only add allows. Ten policies selecting the same pod = the union of their rules. There is no{" "}
          <span className="font-mono">deny</span> rule and no ordering in plain NetworkPolicy.
        </Callout>
        <Callout tone="warn" title="Both ends must agree">
          A connection needs egress allowed at the source <i>and</i> ingress allowed at the destination. Try{" "}
          <span className="font-mono">default-deny-egress</span> without{" "}
          <span className="font-mono">allow-egress-within-namespace</span>: the API&apos;s ingress rule is still there, yet the frontend
          can&apos;t send.
        </Callout>
        <Callout tone="bad" title="The DNS gotcha">
          Default-deny egress also blocks lookups to CoreDNS. Apps then fail with name-resolution timeouts, not &quot;connection
          refused&quot; — which sends people debugging the wrong thing. Hit <b>Forgot DNS</b> above.
        </Callout>
      </div>

      <Section title="Default deny, then punch holes" kicker="the pattern">
        The idiomatic setup per namespace: one policy that isolates everything, one that re-allows DNS, then one small policy per
        legitimate edge in your app. Note the selectors match <span className="font-mono">kubernetes.io/metadata.name</span>, a label
        the API server sets on every namespace automatically, so you don&apos;t have to remember to label namespaces yourself.
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="namespace baseline: deny all + DNS" code={DEFAULT_DENY} />
        <Code lang="bash" title="verifying what is actually enforced" code={TEST} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Callout title="Ports are pod ports">
          Policies are evaluated after the Service is resolved to a pod (DNAT), so the rule says{" "}
          <span className="font-mono">8080</span> (containerPort), not the Service&apos;s <span className="font-mono">80</span>. Named
          ports work too.
        </Callout>
        <Callout title="ipBlock and source IPs">
          ipBlock is meant for addresses outside the cluster. Traffic arriving through a LoadBalancer may already be SNATed to a node
          IP (<span className="font-mono">externalTrafficPolicy: Cluster</span>), so &quot;allow only office IPs&quot; can silently fail
          to match — see <a className="text-accent underline-offset-2 hover:underline" href="/load-balancing">Services &amp; LB</a>.
        </Callout>
      </div>

      <Section title="The namespaceSelector / podSelector gotcha" kicker="yaml is load-bearing">
        Inside a <span className="font-mono">from</span> or <span className="font-mono">to</span> list, selectors in the{" "}
        <i>same</i> item are ANDed; separate items are ORed. The difference is a single <span className="font-mono">-</span>, and
        both versions are valid YAML that the API server accepts without complaint.
      </Section>
      <SelectorGotcha />

      <Section title="Beyond NetworkPolicy" kicker="cluster admins & CNI extensions">
        Plain NetworkPolicy is owned by namespace owners and can only allow. Platform teams usually want guardrails that tenants
        can&apos;t override (&quot;monitoring can always scrape&quot;, &quot;nobody reaches the cloud metadata IP&quot;). SIG
        Network&apos;s policy API working group defines cluster-scoped <b className="text-ink">AdminNetworkPolicy</b> and{" "}
        <b className="text-ink">BaselineAdminNetworkPolicy</b> that sit before and after NetworkPolicy. They are alpha
        CRDs (installed separately), with support in some CNIs — check yours before relying on them. Upstream has since merged
        both into a single <b className="text-ink">ClusterNetworkPolicy</b> (<span className="font-mono">policy.networking.k8s.io/v1alpha2</span>,
        network-policy-api v0.2.0, April 2026) with a <span className="font-mono">tier: Admin | Baseline</span> field; ANP/BANP are no
        longer actively developed, so expect CNIs to migrate.
      </Section>
      <TierStack />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="AdminNetworkPolicy + BaselineAdminNetworkPolicy (v1alpha1, superseded by ClusterNetworkPolicy)" code={ANP} />
        <Code lang="yaml" title="CiliumNetworkPolicy: L7 HTTP rules + FQDN egress" code={CILIUM} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="CNI-native policy">
          <div className="space-y-3 text-sm leading-relaxed text-muted">
            <p>
              <b className="text-ink">Cilium</b> adds <span className="font-mono">CiliumNetworkPolicy</span> /{" "}
              <span className="font-mono">CiliumClusterwideNetworkPolicy</span>: L7 rules (HTTP method/path, gRPC, Kafka, DNS) enforced
              by its Envoy proxy, <span className="font-mono">toFQDNs</span> egress that follows DNS answers instead of hard-coded IPs,
              explicit deny rules, and entities like <span className="font-mono">world</span>,{" "}
              <span className="font-mono">host</span>, <span className="font-mono">kube-apiserver</span>.
            </p>
            <p>
              <b className="text-ink">Calico</b> adds <span className="font-mono">NetworkPolicy</span> and{" "}
              <span className="font-mono">GlobalNetworkPolicy</span> (projectcalico.org/v3) with an <span className="font-mono">order</span>,
              and actions <span className="font-mono">Allow / Deny / Log / Pass</span>, plus host-endpoint protection.
            </p>
            <p>
              Trade-off: richer semantics, but your policies are now tied to one CNI. Start with portable NetworkPolicy and reach for the
              CRDs when you need L7, FQDNs or admin guardrails.
            </p>
          </div>
        </Panel>
        <Code lang="yaml" title="Calico GlobalNetworkPolicy: ordered, explicit deny" code={CALICO} />
      </div>

      <Section title="On Talos" kicker="the CNI decides">
        Talos installs <b className="text-ink">Flannel</b> unless told otherwise. Flannel only builds the pod network — it ignores
        NetworkPolicy entirely, so your objects are accepted by the API server and silently do nothing. For enforcement, set the CNI to{" "}
        <span className="font-mono">none</span> and install Cilium or Calico (see{" "}
        <a className="text-accent underline-offset-2 hover:underline" href="/cilium">
          Cilium on Talos
        </a>
        ).
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="machine config patch (controlplane + workers)" code={TALOS_CNI} />
        <Callout tone="warn" title="Silent no-op is the worst failure mode">
          Nothing warns you that policies aren&apos;t enforced. After installing a CNI, apply a default-deny to a scratch namespace and
          prove a request actually fails before trusting any policy in production.
        </Callout>
      </div>

      <Takeaways
        items={[
          <span key="t1">
            A pod is open until some policy selects it for a direction; then it&apos;s closed except for the <b className="text-ink">union</b>{" "}
            of allows. Both the sender&apos;s egress and the receiver&apos;s ingress must permit a connection.
          </span>,
          <span key="t2">
            Default-deny egress breaks DNS first. Always ship an <span className="font-mono">allow-dns</span> policy alongside it, on UDP{" "}
            <i>and</i> TCP 53.
          </span>,
          <span key="t3">
            Policies are enforced by the CNI, not Kubernetes. Talos&apos; default Flannel ignores them — run Cilium or Calico, and test
            that a deny really drops traffic.
          </span>,
        ]}
      />
    </>
  );
}
