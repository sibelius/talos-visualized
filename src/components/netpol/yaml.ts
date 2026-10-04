import type { MonVariant } from "./model";

const hdr = (name: string) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${name}
  namespace: shop
spec:`;

export function policyYaml(id: string, mon: MonVariant): string {
  switch (id) {
    case "deny-in":
      return `${hdr("default-deny-ingress")}
  podSelector: {}          # every pod in "shop"
  policyTypes: [Ingress]   # ...is now isolated for ingress
  # no ingress rules => nothing is allowed in`;
    case "allow-web":
      return `${hdr("allow-internet-to-frontend")}
  podSelector:
    matchLabels: {app: frontend}
  policyTypes: [Ingress]
  ingress:
  - from:
    - ipBlock:
        cidr: 0.0.0.0/0
        except: [10.0.0.0/8]
    ports:
    - {protocol: TCP, port: 3000}   # the POD port, not the Service port`;
    case "fe-api":
      return `${hdr("allow-frontend-to-api")}
  podSelector:
    matchLabels: {app: api}
  policyTypes: [Ingress]
  ingress:
  - from:
    - podSelector:            # no namespaceSelector =>
        matchLabels:          # pods in THIS namespace only
          app: frontend
    ports:
    - {protocol: TCP, port: 8080}`;
    case "api-db":
      return `${hdr("allow-api-to-db")}
  podSelector:
    matchLabels: {app: db}
  policyTypes: [Ingress]
  ingress:
  - from:
    - podSelector:
        matchLabels: {app: api}
    ports:
    - {protocol: TCP, port: 5432}`;
    case "mon":
      return mon === "and"
        ? `${hdr("allow-prometheus-scrape")}
  podSelector:
    matchLabels: {app: api}
  policyTypes: [Ingress]
  ingress:
  - from:
    - namespaceSelector:      # ONE element with both
        matchLabels:          # selectors => AND
          kubernetes.io/metadata.name: monitoring
      podSelector:
        matchLabels: {app: prometheus}
    ports:
    - {protocol: TCP, port: 9090}`
        : `${hdr("allow-prometheus-scrape")}
  podSelector:
    matchLabels: {app: api}
  policyTypes: [Ingress]
  ingress:
  - from:
    - namespaceSelector:      # item 1: ANY pod in monitoring
        matchLabels:
          kubernetes.io/metadata.name: monitoring
    - podSelector:            # item 2 (note the dash!):
        matchLabels:          # app=prometheus in "shop"
          app: prometheus     # => the two are ORed
    ports:
    - {protocol: TCP, port: 9090}`;
    case "deny-eg":
      return `${hdr("default-deny-egress")}
  podSelector: {}
  policyTypes: [Egress]    # every pod isolated for egress
  # no egress rules => nothing may leave (not even DNS!)`;
    case "dns":
      return `${hdr("allow-dns-egress")}
  podSelector: {}
  policyTypes: [Egress]
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels: {k8s-app: kube-dns}
    ports:
    - {protocol: UDP, port: 53}
    - {protocol: TCP, port: 53}   # large answers fall back to TCP`;
    case "intra":
      return `${hdr("allow-egress-within-namespace")}
  podSelector: {}
  policyTypes: [Egress]
  egress:
  - to:
    - podSelector: {}   # any pod in "shop" — the receiver's
                        # ingress policy still has a say`;
    case "pay":
      return `${hdr("allow-api-to-payments")}
  podSelector:
    matchLabels: {app: api}
  policyTypes: [Egress]
  egress:
  - to:
    - ipBlock:
        cidr: 203.0.113.0/24
    ports:
    - {protocol: TCP, port: 443}`;
  }
  return "";
}
