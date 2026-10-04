import { Fragment } from "react";
import { Callout, Matrix, PageHeader, Panel, Pill, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { ServiceLadder } from "@/components/loadbalancing/ServiceLadder";
import { TrafficPolicy } from "@/components/loadbalancing/TrafficPolicy";
import { GatewayRouter } from "@/components/loadbalancing/GatewayRouter";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/load-balancing");

const SVC_YAML = `
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: LoadBalancer          # ClusterIP ⊂ NodePort ⊂ LoadBalancer
  selector:
    app: web
  ports:
    - port: 80                # ClusterIP port
      targetPort: 8080        # containerPort
      # nodePort: 31080       # auto-picked from 30000-32767 if omitted
  externalTrafficPolicy: Cluster   # or Local (see below)
  # loadBalancerClass: io.cilium/l2-announcer   # pick an implementation explicitly
`;

const METALLB_YAML = `
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: lan-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.1.240-192.168.1.250   # outside your DHCP range!
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement            # or BGPAdvertisement + BGPPeer for BGP mode
metadata:
  name: lan
  namespace: metallb-system
spec:
  ipAddressPools: [lan-pool]
`;

const METALLB_PSA = `
# Talos enforces the "baseline" Pod Security Standard by default.
# MetalLB's speaker needs host networking + NET_RAW, so label its namespace:
apiVersion: v1
kind: Namespace
metadata:
  name: metallb-system
  labels:
    pod-security.kubernetes.io/enforce: privileged
`;

const CILIUM_YAML = `
# Helm values: l2announcements.enabled=true, kubeProxyReplacement=true
apiVersion: cilium.io/v2          # v2alpha1 on older Cilium releases
kind: CiliumLoadBalancerIPPool
metadata:
  name: lan-pool
spec:
  blocks:
    - start: 192.168.1.240
      stop: 192.168.1.250
---
apiVersion: cilium.io/v2alpha1
kind: CiliumL2AnnouncementPolicy
metadata:
  name: lan
spec:
  loadBalancerIPs: true
  interfaces: ["^eth[0-9]+", "^ens[0-9]+"]
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: DoesNotExist
`;

const LOCAL_YAML = `
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local
  # allocated automatically; kube-proxy serves GET /healthz here:
  # 200 + localEndpoints count, or 503 when this node has none
  healthCheckNodePort: 32411
`;

const GATEWAY_YAML = `
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
  namespace: infra
spec:
  gatewayClassName: cilium        # or eg (Envoy Gateway), istio, traefik, nginx…
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.example.com"
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs: [{ name: wildcard-cert }]
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels: { gateway-access: "true" }
`;

const ROUTE_YAML = `
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
  namespace: shop                  # app team's namespace
spec:
  parentRefs:
    - name: public
      namespace: infra
      sectionName: https
  hostnames: ["shop.example.com"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: /api }
          headers: [{ name: x-canary, value: always }]
      backendRefs: [{ name: api-v2, port: 8080 }]
    - matches:
        - path: { type: PathPrefix, value: /api }
      backendRefs:
        - { name: api-v1, port: 8080, weight: 90 }
        - { name: api-v2, port: 8080, weight: 10 }
    - backendRefs: [{ name: shop-web, port: 80 }]   # default match: PathPrefix /
`;

const ROLES = [
  { kind: "GatewayClass", who: "infra provider", what: "Which controller implements gateways (Cilium, Envoy Gateway…). Cluster-scoped.", color: "var(--color-f4)" },
  { kind: "Gateway", who: "cluster operator", what: "Listeners: ports, hostnames, TLS certs, which namespaces may attach routes. Gets the LoadBalancer IP.", color: "var(--color-accent-2)" },
  { kind: "HTTPRoute", who: "app developer", what: "Host/path/header matches, filters, weighted backendRefs. Lives in the app's own namespace.", color: "var(--color-accent)" },
];

export default function Page() {
  return (
    <>
      <PageHeader n="09" title="Services, LB & Gateway">
        A Service is a stable name and virtual IP in front of a churning set of pods. Each Service type adds one more way in: <strong className="text-ink">ClusterIP</strong> for in-cluster
        callers, <strong className="text-ink">NodePort</strong> on every node, <strong className="text-ink">LoadBalancer</strong> for a real external IP. In a cloud that last step is magic;
        on Talos running on Proxmox or bare metal <em>you</em> provide the magic, then put HTTP routing on top with the Gateway API.
      </PageHeader>

      <Section title="The Service ladder" kicker="ClusterIP → NodePort → LoadBalancer">
        Each type is a superset of the previous: a LoadBalancer Service still gets a ClusterIP and (by default) a NodePort. Switch types, then pick how the external IP gets announced and kill
        nodes to watch failover. Note that the pods never change — only how traffic reaches a node does.
      </Section>
      <Panel title="Service types & LoadBalancer implementations">
        <ServiceLadder />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="service.yaml" code={SVC_YAML} />
        <Matrix
          columns={["MetalLB L2", "MetalLB BGP", "Cilium L2 / BGP"]}
          rows={[
            { label: "How the IP is found", cells: ["ARP (IPv4) / NDP (IPv6) reply from one node", "/32 route advertised by every eligible node", "same two modes, built into the CNI"] },
            { label: "Spreads across nodes", cells: ["no — one node per IP", "yes, router ECMP", "L2: no · BGP: yes"] },
            { label: "Failover", cells: ["seconds (memberlist)", "BGP hold timer, or BFD", "L2: Lease expiry · BGP: hold/BFD"] },
            { label: "Needs", cells: ["flat L2 segment", "BGP-capable router", "Cilium; L2 needs kube-proxy replacement"] },
          ]}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Code lang="yaml" title="MetalLB · pool + L2 announcement" code={METALLB_YAML} />
          <Code lang="yaml" title="Talos · Pod Security for MetalLB" code={METALLB_PSA} />
        </div>
        <div className="space-y-4">
          <Code lang="yaml" title="Cilium · LB IPAM + L2 announcements" code={CILIUM_YAML} />
          <Callout tone="info" title="Not the same as Talos' control-plane VIP">
            Talos can float a shared IP between control-plane nodes (<code>machine.network.interfaces[].vip</code>) for the Kubernetes API. That VIP is managed by Talos via etcd election and is
            only for <code>:6443</code>; it does nothing for your Services. Use MetalLB or Cilium for those, and keep both IP ranges out of your DHCP pool.
          </Callout>
        </div>
      </div>

      <Section title="externalTrafficPolicy: Cluster vs Local" kicker="where did my client IP go?">
        Once a packet reaches a node, kube-proxy still has to pick a pod. With <code>Cluster</code> it can pick a pod on another node, which costs a hop and an SNAT. With <code>Local</code> it only
        uses local pods and tells the load balancer which nodes to avoid. Fire a burst and compare what the pods see.
      </Section>
      <Panel title="Packet path simulator">
        <TrafficPolicy />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="preserve the client IP" code={LOCAL_YAML} />
        <Callout tone="warn" title="Local + MetalLB L2 / Cilium L2">
          With <code>Local</code>, L2 announcers only elect a node that actually runs a ready endpoint, otherwise the VIP would lead to a node that drops traffic. When that pod moves, the VIP moves
          too — expect a short blip during rollouts. For HTTP you usually don&apos;t need <code>Local</code> on every app: put it on the Gateway&apos;s Service and pass the client IP onward in{" "}
          <code>X-Forwarded-For</code>.
        </Callout>
      </div>

      <Section title="Ingress → Gateway API" kicker="L7 routing">
        An L4 LoadBalancer gives you one IP per Service. For HTTP you want <em>one</em> IP and route by host and path. That was Ingress: a single resource where the app team, the TLS certificates
        and controller-specific annotations all collided. The Gateway API (<code>gateway.networking.k8s.io/v1</code>, GA since 2023) splits it by role and makes traffic splitting, header matching
        and cross-namespace attachment first-class instead of annotations.
      </Section>

      <Callout tone="warn" title="ingress-nginx is retired">
        In November 2025 Kubernetes SIG Network and the Security Response Committee announced the retirement of the community <code>kubernetes/ingress-nginx</code> controller, with best-effort
        maintenance only until March 2026. After that there are no further releases, bug fixes or security patches. Existing installs keep running, but you are on your own. The <code>Ingress</code>{" "}
        API itself is not removed (it&apos;s frozen); the recommended path for new work is the Gateway API. (F5&apos;s separate NGINX Ingress Controller is a different project.)
      </Callout>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ROLES.map((r, i) => (
          <div key={r.kind} className="relative rounded-xl border border-line bg-panel p-4">
            <div className="mb-1 font-mono text-sm" style={{ color: r.color }}>
              {r.kind}
            </div>
            <Pill>{r.who}</Pill>
            <p className="mt-2 text-sm leading-relaxed text-muted">{r.what}</p>
            {i < 2 && <span aria-hidden className="absolute top-1/2 -right-3 hidden -translate-y-1/2 text-faint md:block">→</span>}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Panel title="Request router · Gateway → HTTPRoute → weighted backends">
          <GatewayRouter />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code lang="yaml" title="gateway.yaml (cluster operator)" code={GATEWAY_YAML} />
        <Code lang="yaml" title="httproute.yaml (app team) · 90/10 canary" code={ROUTE_YAML} />
      </div>

      <div className="mt-4">
        <Matrix
          columns={["Ingress", "Gateway API"]}
          rows={[
            { label: "Ownership", cells: ["one object mixes infra + app concerns", "GatewayClass / Gateway / Route split by role"] },
            { label: "Traffic split, header match", cells: ["controller-specific annotations", "built in: weight, headers, query params, method"] },
            { label: "Protocols", cells: ["HTTP(S) only", "HTTP, gRPC (GRPCRoute); TLS/TCP/UDP routes in experimental channel"] },
            { label: "Cross-namespace", cells: ["no", "allowedRoutes + ReferenceGrant"] },
            { label: "Portability", cells: ["annotations differ per controller", "same YAML across conformant implementations"] },
            {
              label: "Implementations",
              cells: ["ingress-nginx (retired), Traefik, HAProxy, cloud controllers…", "Cilium, Envoy Gateway, Istio, Traefik, NGINX Gateway Fabric, kgateway…"],
            },
          ]}
        />
      </div>

      <div className="mt-4">
        <Callout tone="info" title="On Talos + Cilium">
          If Cilium is your CNI with kube-proxy replacement, enabling its Gateway API support (<code>gatewayAPI.enabled=true</code>, after installing the Gateway API CRDs) gives you a{" "}
          <code>cilium</code> GatewayClass with no extra proxy Deployment: each Gateway becomes a LoadBalancer Service handed out by Cilium LB IPAM and announced via L2 or BGP — the whole stack on
          this page in one component.
        </Callout>
      </div>

      <Takeaways
        items={[
          <Fragment key="t0">A <strong className="text-ink">LoadBalancer</strong> Service is just a request. On Proxmox or bare metal something must answer it — MetalLB or Cilium LB IPAM — or EXTERNAL-IP stays <code>&lt;pending&gt;</code>.</Fragment>,
          <Fragment key="t1">L2 mode means one node carries each IP and failover takes seconds; BGP gives ECMP across nodes but needs a router that speaks it. <code>externalTrafficPolicy: Local</code> keeps the client IP at the cost of uneven spread.</Fragment>,
          <Fragment key="t2">Route HTTP with the <strong className="text-ink">Gateway API</strong>: operators own Gateways and certificates, app teams own HTTPRoutes, and canaries are a <code>weight</code>, not an annotation. ingress-nginx is retired; plan the migration.</Fragment>,
        ]}
      />
    </>
  );
}
