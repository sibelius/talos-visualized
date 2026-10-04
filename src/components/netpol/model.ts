// A tiny, faithful-enough NetworkPolicy evaluator used by the simulator.
// Semantics modelled:
//  - policies are namespaced and select pods via podSelector ({} = all pods in the namespace)
//  - a pod is isolated for a direction once ANY policy selecting it lists that direction in policyTypes
//  - isolated pods only allow traffic matched by the union of rules of all selecting policies
//  - a connection needs egress allowed at the source AND ingress allowed at the destination
//  - peers inside one `from`/`to` element are ANDed (namespaceSelector + podSelector), list items are ORed
//  - podSelector without namespaceSelector means "pods in the policy's own namespace"

export type Labels = Record<string, string>;
export type Proto = "TCP" | "UDP";

export type Endpoint =
  | { kind: "pod"; id: string; name: string; ns: string; labels: Labels }
  | { kind: "ext"; id: string; name: string; ip: string };

export type Peer = {
  podSelector?: Labels;
  namespaceSelector?: Labels;
  ipBlock?: { cidr: string; except?: string[] };
};

export type Rule = { peers?: Peer[]; ports?: { port: number; protocol: Proto }[] };

export type Policy = {
  id: string;
  name: string;
  ns: string;
  podSelector: Labels;
  types: ("Ingress" | "Egress")[];
  ingress?: Rule[];
  egress?: Rule[];
};

export type Flow = { id: string; src: string; dst: string; port: number; protocol: Proto; label: string; why: string };

export const NAMESPACES: Record<string, Labels> = {
  shop: { "kubernetes.io/metadata.name": "shop" },
  monitoring: { "kubernetes.io/metadata.name": "monitoring" },
  "kube-system": { "kubernetes.io/metadata.name": "kube-system" },
};

export const ENDPOINTS: Endpoint[] = [
  { kind: "ext", id: "client", name: "internet client", ip: "198.51.100.7" },
  { kind: "pod", id: "frontend", name: "frontend", ns: "shop", labels: { app: "frontend" } },
  { kind: "pod", id: "api", name: "api", ns: "shop", labels: { app: "api" } },
  { kind: "pod", id: "db", name: "db", ns: "shop", labels: { app: "db" } },
  { kind: "pod", id: "prometheus", name: "prometheus", ns: "monitoring", labels: { app: "prometheus" } },
  { kind: "pod", id: "toolbox", name: "toolbox", ns: "monitoring", labels: { app: "toolbox" } },
  { kind: "pod", id: "dns", name: "coredns", ns: "kube-system", labels: { "k8s-app": "kube-dns" } },
  { kind: "ext", id: "payments", name: "payments API", ip: "203.0.113.10" },
  { kind: "ext", id: "evil", name: "unknown host", ip: "192.0.2.66" },
];

export const byId = Object.fromEntries(ENDPOINTS.map((e) => [e.id, e])) as Record<string, Endpoint>;

export const FLOWS: Flow[] = [
  { id: "client-fe", src: "client", dst: "frontend", port: 3000, protocol: "TCP", label: "HTTP :3000", why: "Users reach the frontend (via a LoadBalancer/Gateway — the policy sees the pod port, not the Service port)." },
  { id: "fe-api", src: "frontend", dst: "api", port: 8080, protocol: "TCP", label: ":8080", why: "The frontend calls the API." },
  { id: "api-db", src: "api", dst: "db", port: 5432, protocol: "TCP", label: ":5432", why: "The API talks to Postgres." },
  { id: "fe-db", src: "frontend", dst: "db", port: 5432, protocol: "TCP", label: ":5432", why: "Should NOT happen: a compromised frontend going straight for the database (lateral movement)." },
  { id: "prom-api", src: "prometheus", dst: "api", port: 9090, protocol: "TCP", label: ":9090", why: "Prometheus scrapes API metrics from another namespace." },
  { id: "tool-api", src: "toolbox", dst: "api", port: 9090, protocol: "TCP", label: ":9090", why: "Should NOT happen: some random pod in the monitoring namespace poking the API." },
  { id: "fe-dns", src: "frontend", dst: "dns", port: 53, protocol: "UDP", label: "DNS 53/udp", why: "Every pod resolves Service names (api.shop.svc) through CoreDNS first." },
  { id: "api-dns", src: "api", dst: "dns", port: 53, protocol: "UDP", label: "DNS 53/udp", why: "The API resolves db.shop.svc and the payments hostname." },
  { id: "api-pay", src: "api", dst: "payments", port: 443, protocol: "TCP", label: ":443", why: "The API calls an external payment provider (203.0.113.0/24)." },
  { id: "db-evil", src: "db", dst: "evil", port: 443, protocol: "TCP", label: ":443", why: "Should NOT happen: data exfiltration from the database pod." },
];

export type MonVariant = "and" | "or";

export function buildPolicies(mon: MonVariant): Policy[] {
  return [
    { id: "deny-in", name: "default-deny-ingress", ns: "shop", podSelector: {}, types: ["Ingress"], ingress: [] },
    {
      id: "allow-web",
      name: "allow-internet-to-frontend",
      ns: "shop",
      podSelector: { app: "frontend" },
      types: ["Ingress"],
      ingress: [{ peers: [{ ipBlock: { cidr: "0.0.0.0/0", except: ["10.0.0.0/8"] } }], ports: [{ port: 3000, protocol: "TCP" }] }],
    },
    {
      id: "fe-api",
      name: "allow-frontend-to-api",
      ns: "shop",
      podSelector: { app: "api" },
      types: ["Ingress"],
      ingress: [{ peers: [{ podSelector: { app: "frontend" } }], ports: [{ port: 8080, protocol: "TCP" }] }],
    },
    {
      id: "api-db",
      name: "allow-api-to-db",
      ns: "shop",
      podSelector: { app: "db" },
      types: ["Ingress"],
      ingress: [{ peers: [{ podSelector: { app: "api" } }], ports: [{ port: 5432, protocol: "TCP" }] }],
    },
    {
      id: "mon",
      name: "allow-prometheus-scrape",
      ns: "shop",
      podSelector: { app: "api" },
      types: ["Ingress"],
      ingress: [
        {
          peers:
            mon === "and"
              ? [{ namespaceSelector: NAMESPACES.monitoring, podSelector: { app: "prometheus" } }]
              : [{ namespaceSelector: NAMESPACES.monitoring }, { podSelector: { app: "prometheus" } }],
          ports: [{ port: 9090, protocol: "TCP" }],
        },
      ],
    },
    { id: "deny-eg", name: "default-deny-egress", ns: "shop", podSelector: {}, types: ["Egress"], egress: [] },
    {
      id: "dns",
      name: "allow-dns-egress",
      ns: "shop",
      podSelector: {},
      types: ["Egress"],
      egress: [
        {
          peers: [{ namespaceSelector: NAMESPACES["kube-system"], podSelector: { "k8s-app": "kube-dns" } }],
          ports: [
            { port: 53, protocol: "UDP" },
            { port: 53, protocol: "TCP" },
          ],
        },
      ],
    },
    {
      id: "intra",
      name: "allow-egress-within-namespace",
      ns: "shop",
      podSelector: {},
      types: ["Egress"],
      egress: [{ peers: [{ podSelector: {} }] }],
    },
    {
      id: "pay",
      name: "allow-api-to-payments",
      ns: "shop",
      podSelector: { app: "api" },
      types: ["Egress"],
      egress: [{ peers: [{ ipBlock: { cidr: "203.0.113.0/24" } }], ports: [{ port: 443, protocol: "TCP" }] }],
    },
  ];
}

// ---------- matching ----------

export function matchLabels(sel: Labels, labels: Labels) {
  return Object.entries(sel).every(([k, v]) => labels[k] === v);
}

function ipToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
export function inCidr(ip: string, cidr: string) {
  const [base, bitsS] = cidr.split("/");
  const bits = Number(bitsS);
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

/** Does `peer` (written in a policy living in `policyNs`) match endpoint `ep`? */
export function peerMatches(peer: Peer, policyNs: string, ep: Endpoint): boolean {
  if (peer.ipBlock) {
    // ipBlock is meant for cluster-external addresses; we only match external endpoints here.
    if (ep.kind !== "ext") return false;
    return inCidr(ep.ip, peer.ipBlock.cidr) && !(peer.ipBlock.except ?? []).some((c) => inCidr(ep.ip, c));
  }
  if (ep.kind !== "pod") return false;
  const nsOk = peer.namespaceSelector ? matchLabels(peer.namespaceSelector, NAMESPACES[ep.ns] ?? {}) : ep.ns === policyNs;
  const podOk = peer.podSelector ? matchLabels(peer.podSelector, ep.labels) : true;
  return nsOk && podOk;
}

function ruleMatches(rule: Rule, policyNs: string, peer: Endpoint, port: number, protocol: Proto) {
  const peerOk = !rule.peers || rule.peers.some((p) => peerMatches(p, policyNs, peer));
  const portOk = !rule.ports || rule.ports.some((p) => p.port === port && p.protocol === protocol);
  return peerOk && portOk;
}

export type SideVerdict = {
  enforced: boolean; // false when the endpoint is outside the cluster
  isolated: boolean;
  allowed: boolean;
  selecting: string[]; // policy names that select this pod for this direction
  allowedBy: string[]; // policy names whose rules matched
};

function side(dir: "Ingress" | "Egress", self: Endpoint, other: Endpoint, flow: Flow, policies: Policy[]): SideVerdict {
  if (self.kind !== "pod") return { enforced: false, isolated: false, allowed: true, selecting: [], allowedBy: [] };
  const selecting = policies.filter((p) => p.ns === self.ns && p.types.includes(dir) && matchLabels(p.podSelector, self.labels));
  if (!selecting.length) return { enforced: true, isolated: false, allowed: true, selecting: [], allowedBy: [] };
  const allowedBy = selecting.filter((p) =>
    (dir === "Ingress" ? p.ingress : p.egress)?.some((r) => ruleMatches(r, p.ns, other, flow.port, flow.protocol)),
  );
  return {
    enforced: true,
    isolated: true,
    allowed: allowedBy.length > 0,
    selecting: selecting.map((p) => p.name),
    allowedBy: allowedBy.map((p) => p.name),
  };
}

export type Verdict = { allowed: boolean; egress: SideVerdict; ingress: SideVerdict };

export function evaluate(flow: Flow, policies: Policy[]): Verdict {
  const src = byId[flow.src];
  const dst = byId[flow.dst];
  const egress = side("Egress", src, dst, flow, policies);
  const ingress = side("Ingress", dst, src, flow, policies);
  return { allowed: egress.allowed && ingress.allowed, egress, ingress };
}
