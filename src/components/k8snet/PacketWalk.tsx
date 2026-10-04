"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Pill, Segmented } from "../ui";

/* ------------------------------------------------------------------ */
/* Topology                                                            */
/* ------------------------------------------------------------------ */

const P = {
  a1: [95, 72],
  a2: [255, 72],
  vA1: [95, 132],
  vA2: [255, 132],
  brA: [175, 178],
  nfA: [175, 226],
  vxA: [298, 226],
  ethA: [175, 284],
  b1: [465, 72],
  dns: [625, 72],
  vB1: [465, 132],
  vDns: [625, 132],
  brB: [545, 178],
  nfB: [545, 226],
  vxB: [668, 226],
  ethB: [545, 284],
  sw: [360, 340],
  ext: [360, 392],
} as const satisfies Record<string, readonly [number, number]>;

type PKey = keyof typeof P;

const IP = {
  a1: "10.244.1.5",
  a2: "10.244.1.6",
  b1: "10.244.2.7",
  dns: "10.244.2.10",
  nodeA: "192.168.1.11",
  nodeB: "192.168.1.12",
  svc: "10.96.120.15",
  kubeDns: "10.96.0.10",
  client: "203.0.113.50",
};

type Hdr = { src: string; dst: string; proto?: string };
type Step = {
  path: PKey[];
  title: string;
  body: ReactNode;
  pkt: Hdr;
  outer?: Hdr & { info: string };
  code?: { title: string; lines: string[]; hl?: number[] };
  hl?: PKey[];
  verdict?: "ok" | "bad";
};

type Scenario = "same" | "cross" | "svc" | "dns" | "nodeport";

/* ------------------------------------------------------------------ */
/* Scenario builders                                                   */
/* ------------------------------------------------------------------ */

const ROUTES_A_OVERLAY = [
  "$ ip route   # on node A (192.168.1.11)",
  "default via 192.168.1.1 dev eth0",
  "10.244.1.0/24 dev cni0 proto kernel scope link src 10.244.1.1",
  "10.244.2.0/24 via 10.244.2.0 dev flannel.1 onlink",
  "192.168.1.0/24 dev eth0 proto kernel scope link",
];
const ROUTES_A_NATIVE = [
  "$ ip route   # on node A (192.168.1.11)",
  "default via 192.168.1.1 dev eth0",
  "10.244.1.0/24 dev cni0 proto kernel scope link src 10.244.1.1",
  "10.244.2.0/24 via 192.168.1.12 dev eth0",
  "192.168.1.0/24 dev eth0 proto kernel scope link",
];

function sameNode(): Step[] {
  const pkt = { src: IP.a1, dst: IP.a2, proto: "TCP :8080" };
  return [
    {
      path: ["a1"],
      title: "web-1 opens a connection to api-1's pod IP",
      body: (
        <>
          Inside its network namespace the pod sees one interface, <b>eth0</b>, with a /32-ish address from the node&apos;s
          podCIDR and a default route to the node. Nothing about the destination is special: it&apos;s just an IP.
        </>
      ),
      pkt,
      code: {
        title: "inside pod web-1",
        lines: ["$ ip addr show eth0", "    inet 10.244.1.5/24 scope global eth0", "$ ip route", "default via 10.244.1.1 dev eth0", "10.244.1.0/24 dev eth0 scope link"],
        hl: [1, 3],
      },
      hl: ["a1"],
    },
    {
      path: ["vA1"],
      title: "Out through the veth pair",
      body: (
        <>
          A <b>veth pair</b> is a virtual cable: whatever enters one end exits the other. One end is the pod&apos;s eth0, the
          other end (<span className="font-mono">veth3f2a…</span>) lives in the host network namespace.
        </>
      ),
      pkt,
      hl: ["vA1"],
    },
    {
      path: ["brA"],
      title: "The node switches it locally",
      body: (
        <>
          With Flannel the host end is plugged into the Linux bridge <b>cni0</b>; the destination is on the same /24, so the
          bridge forwards it at L2. (Cilium skips the bridge: an eBPF program on the veth redirects straight to the peer
          veth.) No NAT anywhere.
        </>
      ),
      pkt,
      code: { title: "node A", lines: ["$ bridge link", "7: veth3f2a@if2: master cni0 state forwarding", "8: veth91cd@if2: master cni0 state forwarding"] },
      hl: ["brA"],
    },
    {
      path: ["vA2", "a2"],
      title: "Delivered: api-1 sees the real source IP",
      body: (
        <>
          The packet arrives with <span className="font-mono">src 10.244.1.5</span> untouched. That&apos;s the Kubernetes
          network model: every pod gets its own IP and pods reach each other <b>without NAT</b>, so the source address is
          meaningful (for logs, for NetworkPolicy, for allow-lists).
        </>
      ),
      pkt,
      hl: ["a2"],
      verdict: "ok",
    },
  ];
}

function crossNode(mode: "overlay" | "native"): Step[] {
  const pkt = { src: IP.a1, dst: IP.b1, proto: "TCP :8080" };
  const outer = { src: IP.nodeA, dst: IP.nodeB, proto: "UDP :8472", info: "VXLAN VNI 1" };
  const steps: Step[] = [
    {
      path: ["a1"],
      title: "web-1 talks to api-2 on another node",
      body: <>Same as before from the pod&apos;s point of view: destination 10.244.2.7, default route to the node.</>,
      pkt,
      hl: ["a1"],
    },
    {
      path: ["vA1", "brA", "nfA"],
      title: "Node A does a route lookup",
      body:
        mode === "overlay" ? (
          <>
            10.244.2.0/24 is node B&apos;s podCIDR. Flannel installed a route sending it to the <b>flannel.1</b> VXLAN
            device, plus a static ARP/FDB entry mapping node B&apos;s VTEP to 192.168.1.12.
          </>
        ) : (
          <>
            In native routing mode the route points straight at node B&apos;s underlay IP. That only works if the network
            between nodes knows pod routes: same L2 segment (Flannel <span className="font-mono">host-gw</span>), or a
            router that learned them via <b>BGP</b> (Calico, Cilium, kube-router).
          </>
        ),
      pkt,
      code: { title: "node A", lines: mode === "overlay" ? ROUTES_A_OVERLAY : ROUTES_A_NATIVE, hl: [3] },
      hl: ["nfA"],
    },
  ];
  if (mode === "overlay") {
    steps.push(
      {
        path: ["vxA"],
        title: "Encapsulate: pod packet inside a UDP packet",
        body: (
          <>
            The VTEP wraps the whole pod frame in <b>outer IP + UDP (port 8472) + VXLAN</b> headers addressed node→node. The
            underlay only ever sees node IPs, so it needs zero knowledge of pods. Cost: 50 bytes per packet, hence pod MTU
            1450 on a 1500 network.
          </>
        ),
        pkt,
        outer,
        hl: ["vxA"],
      },
      {
        path: ["ethA", "sw", "ethB"],
        title: "Across the underlay as plain node-to-node UDP",
        body: <>Switches and routers forward on the outer header: 192.168.1.11 → 192.168.1.12. The pod IPs ride inside, invisible.</>,
        pkt,
        outer,
        hl: ["sw"],
      },
      {
        path: ["vxB"],
        title: "Node B decapsulates",
        body: <>UDP 8472 is claimed by the kernel VXLAN device on node B, which strips the outer headers and hands the original packet to the routing stack.</>,
        pkt,
        hl: ["vxB"],
      },
    );
  } else {
    steps.push({
      path: ["ethA", "sw", "ethB"],
      title: "Routed natively — no wrapper",
      body: (
        <>
          The packet leaves eth0 as-is: src 10.244.1.5, dst 10.244.2.7. Full 1500 MTU, no encap CPU cost, and packet
          captures on the wire show real pod IPs. The price: the fabric must carry pod routes.
        </>
      ),
      pkt,
      code: { title: "ToR router (learned via BGP)", lines: ["B>* 10.244.1.0/24 via 192.168.1.11, eth3", "B>* 10.244.2.0/24 via 192.168.1.12, eth3"], hl: [1] },
      hl: ["sw"],
    });
  }
  steps.push(
    {
      path: ["nfB", "brB"],
      title: "Node B routes to its local bridge",
      body: <>10.244.2.0/24 is local on node B (<span className="font-mono">dev cni0</span>), so it&apos;s switched to the right veth.</>,
      pkt,
      hl: ["brB"],
    },
    {
      path: ["vB1", "b1"],
      title: "Delivered with the original source IP",
      body: <>api-2 sees src 10.244.1.5. Cross-node traffic is still NAT-free — either tunnelled or routed, but never rewritten.</>,
      pkt,
      hl: ["b1"],
      verdict: "ok",
    },
  );
  return steps;
}

function svcChain(pick: "a2" | "b1", hl: number[]) {
  return {
    title: "iptables-save -t nat (kube-proxy, iptables mode)",
    lines: [
      "-A PREROUTING -j KUBE-SERVICES",
      "-A KUBE-SERVICES -d 10.96.120.15/32 -p tcp --dport 80 -j KUBE-SVC-7RQXWV4N",
      "-A KUBE-SVC-7RQXWV4N -m statistic --mode random --probability 0.50000 -j KUBE-SEP-ZK3Q",
      "-A KUBE-SVC-7RQXWV4N -j KUBE-SEP-H8WL",
      "-A KUBE-SEP-ZK3Q -p tcp -j DNAT --to-destination 10.244.1.6:8080",
      "-A KUBE-SEP-H8WL -p tcp -j DNAT --to-destination 10.244.2.7:8080",
    ],
    hl: hl.length ? hl : pick === "a2" ? [4] : [5],
  };
}

function service(pick: "a2" | "b1"): Step[] {
  const pre = { src: IP.a1, dst: `${IP.svc}:80`, proto: "TCP" };
  const post = { src: IP.a1, dst: `${IP[pick]}:8080`, proto: "TCP" };
  const epName = pick === "a2" ? "api-1 (same node)" : "api-2 (node B)";
  const steps: Step[] = [
    {
      path: ["a1"],
      title: "web-1 connects to the Service ClusterIP",
      body: (
        <>
          <span className="font-mono">api.default.svc</span> resolved to <b>10.96.120.15</b>, a virtual IP from the service
          CIDR. No interface anywhere owns this address — it only exists as rules on every node.
        </>
      ),
      pkt: pre,
      hl: ["a1"],
    },
    {
      path: ["vA1", "brA", "nfA"],
      title: "PREROUTING → KUBE-SERVICES matches the ClusterIP",
      body: <>The packet hits netfilter on the node before routing. kube-proxy&apos;s top chain lists every Service; this one matches dst 10.96.120.15:80.</>,
      pkt: pre,
      code: svcChain(pick, [0, 1]),
      hl: ["nfA"],
    },
    {
      path: ["nfA"],
      title: "KUBE-SVC picks an endpoint at random",
      body: (
        <>
          With N ready endpoints the chain has N rules with probabilities 1/N, 1/(N−1), … 1. Here: 50% the first, else the
          second — a uniform pick. This happens only for the <b>first packet</b>; conntrack remembers the choice.
        </>
      ),
      pkt: pre,
      code: svcChain(pick, [2, 3]),
      hl: ["nfA"],
    },
    {
      path: ["nfA"],
      title: `KUBE-SEP DNATs to ${epName}`,
      body: (
        <>
          The destination is rewritten from the ClusterIP to a pod IP from the <b>EndpointSlice</b>. From now on this is
          ordinary pod-to-pod traffic. The reply gets the reverse rewrite (src pod IP → ClusterIP) via conntrack, so web-1
          only ever sees 10.96.120.15.
        </>
      ),
      pkt: post,
      code: svcChain(pick, []),
      hl: ["nfA"],
    },
  ];
  if (pick === "a2") {
    steps.push({
      path: ["brA", "vA2", "a2"],
      title: "Delivered to api-1 locally",
      body: <>Endpoint on the same node: switched via cni0. Source IP preserved — only the destination changed.</>,
      pkt: post,
      hl: ["a2"],
      verdict: "ok",
    });
  } else {
    steps.push(
      {
        path: ["vxA", "ethA", "sw", "ethB", "vxB"],
        title: "Then it's just cross-node pod traffic",
        body: <>Encapsulated node A → node B like any pod packet (Flannel VXLAN here).</>,
        pkt: post,
        outer: { src: IP.nodeA, dst: IP.nodeB, proto: "UDP :8472", info: "VXLAN VNI 1" },
        hl: ["sw"],
      },
      {
        path: ["nfB", "brB", "vB1", "b1"],
        title: "Delivered to api-2",
        body: <>Load balancing was done on the <b>client&apos;s</b> node — there is no central load balancer box for ClusterIP traffic.</>,
        pkt: post,
        hl: ["b1"],
        verdict: "ok",
      },
    );
  }
  return steps;
}

const DNS_Q = [
  "api.example.com.default.svc.cluster.local",
  "api.example.com.svc.cluster.local",
  "api.example.com.cluster.local",
  "api.example.com.",
];

function dnsLines(upto: number) {
  return {
    title: "queries sent (A + AAAA each, in parallel)",
    lines: DNS_Q.map((q, i) => {
      if (i > upto) return `${i + 1}. ${q}`;
      const ans = i < 3 ? "NXDOMAIN" : "NOERROR 93.184.215.14";
      return `${i + 1}. ${q.padEnd(44)} → ${ans}`;
    }),
    hl: [upto],
  };
}

function dns(): Step[] {
  const q = { src: `${IP.a1}:41234`, dst: `${IP.kubeDns}:53`, proto: "UDP" };
  const qn = { src: `${IP.a1}:41234`, dst: `${IP.dns}:53`, proto: "UDP" };
  const steps: Step[] = [
    {
      path: ["a1"],
      title: "web-1 wants api.example.com",
      body: (
        <>
          kubelet wrote this resolv.conf. <b>ndots:5</b> means: any name with fewer than 5 dots is tried against the search
          list <i>first</i>. &quot;api.example.com&quot; has 2 dots, so it&apos;s treated as possibly-relative.
        </>
      ),
      pkt: q,
      code: {
        title: "/etc/resolv.conf inside the pod",
        lines: ["search default.svc.cluster.local svc.cluster.local cluster.local", "nameserver 10.96.0.10", "options ndots:5"],
        hl: [0, 2],
      },
      hl: ["a1"],
    },
    {
      path: ["vA1", "brA", "nfA"],
      title: "kube-dns is a Service too",
      body: <>10.96.0.10 is the ClusterIP of the kube-dns Service (Talos picks the 10th IP of the service CIDR). kube-proxy DNATs it to a CoreDNS pod.</>,
      pkt: qn,
      hl: ["nfA"],
    },
  ];
  DNS_Q.forEach((name, i) => {
    const last = i === DNS_Q.length - 1;
    steps.push({
      path: i === 0 ? ["vxA", "ethA", "sw", "ethB", "vxB", "nfB", "brB", "vDns", "dns"] : ["dns"],
      title: last ? `Query ${i + 1}: finally the absolute name` : `Query ${i + 1}: ${name.split(".").slice(3).join(".")}`,
      body: last ? (
        <>
          After three wasted round-trips the resolver tries the name as-is. CoreDNS isn&apos;t authoritative for it, so it
          forwards upstream (on Talos: to the node&apos;s host DNS cache, then your resolvers) and caches the answer.
        </>
      ) : (
        <>
          CoreDNS answers authoritatively for <span className="font-mono">cluster.local</span>: no such Service →{" "}
          <b className="text-bad">NXDOMAIN</b>. The pod&apos;s resolver moves on to the next search domain.
        </>
      ),
      pkt: { ...qn, proto: `UDP  Q: ${name}` },
      code: dnsLines(i),
      hl: ["dns"],
      verdict: last ? "ok" : "bad",
    });
  });
  steps.push({
    path: ["vDns", "brB", "nfB", "vxB", "ethB", "sw", "ethA", "vxA", "nfA", "brA", "vA1", "a1"],
    title: "Answer returns — 4 queries × 2 (A/AAAA) = 8 lookups",
    body: (
      <>
        conntrack un-DNATs the reply so it appears to come from 10.96.0.10. Fixes: use a trailing dot (
        <span className="font-mono">api.example.com.</span>), lower <span className="font-mono">ndots</span> via the
        pod&apos;s <span className="font-mono">dnsConfig</span>, or run NodeLocal DNSCache to absorb the NXDOMAIN storm.
      </>
    ),
    pkt: { src: `${IP.kubeDns}:53`, dst: `${IP.a1}:41234`, proto: "UDP  A 93.184.215.14" },
    code: dnsLines(3),
    hl: ["a1"],
    verdict: "ok",
  });
  return steps;
}

function nodePort(etp: "Cluster" | "Local"): Step[] {
  if (etp === "Local") {
    const pre = { src: IP.client, dst: `${IP.nodeA}:31080`, proto: "TCP" };
    const post = { src: IP.client, dst: `${IP.a2}:8080`, proto: "TCP" };
    return [
      {
        path: ["ext"],
        title: "Client hits a node that has a local endpoint",
        body: (
          <>
            With <span className="font-mono">externalTrafficPolicy: Local</span> only nodes running a ready endpoint accept
            the traffic; an external LB uses the <span className="font-mono">healthCheckNodePort</span> to skip the others.
          </>
        ),
        pkt: pre,
        hl: ["ext"],
      },
      {
        path: ["sw", "ethA", "nfA"],
        title: "KUBE-NODEPORTS → local endpoints only",
        body: <>DNAT to a pod on <i>this</i> node. No SNAT is needed because the reply will naturally leave from this same node.</>,
        pkt: post,
        code: {
          title: "kube-proxy chains",
          lines: ["-A KUBE-SERVICES -m addrtype --dst-type LOCAL -j KUBE-NODEPORTS", "-A KUBE-NODEPORTS -p tcp --dport 31080 -j KUBE-EXT-7RQXWV4N", "-A KUBE-EXT-7RQXWV4N -j KUBE-SVL-7RQXWV4N   # local endpoints only", "-A KUBE-SEP-ZK3Q -p tcp -j DNAT --to-destination 10.244.1.6:8080"],
          hl: [2, 3],
        },
        hl: ["nfA"],
      },
      {
        path: ["brA", "vA2", "a2"],
        title: "Client IP preserved",
        body: <>api-1 sees the real client 203.0.113.50 — good for logs and allow-lists. Trade-off: load is spread per node, not per pod, and nodes without endpoints refuse.</>,
        pkt: post,
        hl: ["a2"],
        verdict: "ok",
      },
    ];
  }
  const pre = { src: IP.client, dst: `${IP.nodeB}:31080`, proto: "TCP" };
  const dnat = { src: IP.client, dst: `${IP.a2}:8080`, proto: "TCP" };
  const snat = { src: IP.nodeB, dst: `${IP.a2}:8080`, proto: "TCP" };
  return [
    {
      path: ["ext"],
      title: "External client hits any node's IP on the NodePort",
      body: <>A NodePort (30000–32767) is opened on <b>every</b> node. The client picked node B, which has no api pod.</>,
      pkt: pre,
      hl: ["ext"],
    },
    {
      path: ["sw", "ethB", "nfB"],
      title: "DNAT to an endpoint — which may be on another node",
      body: <>KUBE-NODEPORTS matches :31080 and load-balances across all endpoints cluster-wide. It picked api-1 on node A.</>,
      pkt: dnat,
      code: {
        title: "kube-proxy chains on node B",
        lines: ["-A KUBE-NODEPORTS -p tcp --dport 31080 -j KUBE-EXT-7RQXWV4N", "-A KUBE-EXT-7RQXWV4N -j KUBE-MARK-MASQ", "-A KUBE-EXT-7RQXWV4N -j KUBE-SVC-7RQXWV4N", "-A KUBE-SEP-ZK3Q -p tcp -j DNAT --to-destination 10.244.1.6:8080"],
        hl: [0, 3],
      },
      hl: ["nfB"],
    },
    {
      path: ["nfB"],
      title: "…and SNAT (masquerade) to node B",
      body: (
        <>
          If node A replied directly to 203.0.113.50 the client would get a packet from the wrong IP and drop it. So node B
          rewrites the source to itself, forcing the reply back through B. Cost: <b>the pod loses the client IP</b>.
        </>
      ),
      pkt: snat,
      code: {
        title: "POSTROUTING",
        lines: ["-A KUBE-POSTROUTING -m mark --mark 0x4000/0x4000 -j MASQUERADE"],
        hl: [0],
      },
      hl: ["nfB"],
    },
    {
      path: ["vxB", "ethB", "sw", "ethA", "vxA"],
      title: "Hop to node A through the overlay",
      body: <>An extra hop that externalTrafficPolicy: Local avoids.</>,
      pkt: snat,
      outer: { src: IP.nodeB, dst: IP.nodeA, proto: "UDP :8472", info: "VXLAN VNI 1" },
      hl: ["sw"],
    },
    {
      path: ["nfA", "brA", "vA2", "a2"],
      title: "Delivered — source is node B, not the client",
      body: <>Replies go a2 → node B (un-SNAT, un-DNAT) → client. Switch to <b>Local</b> above to compare.</>,
      pkt: snat,
      hl: ["a2"],
      verdict: "ok",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "same", label: "Pod→Pod (same node)" },
  { value: "cross", label: "Pod→Pod (cross node)" },
  { value: "svc", label: "Pod→ClusterIP" },
  { value: "dns", label: "DNS lookup" },
  { value: "nodeport", label: "External→NodePort" },
];

function dist(a: readonly [number, number], b: readonly [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function PacketWalk() {
  const [scenario, setScenario] = useState<Scenario>("cross");
  const [mode, setMode] = useState<"overlay" | "native">("overlay");
  const [pick, setPick] = useState<"a2" | "b1">("b1");
  const [etp, setEtp] = useState<"Cluster" | "Local">("Cluster");
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const steps = useMemo(() => {
    switch (scenario) {
      case "same":
        return sameNode();
      case "cross":
        return crossNode(mode);
      case "svc":
        return service(pick);
      case "dns":
        return dns();
      case "nodeport":
        return nodePort(etp);
    }
  }, [scenario, mode, pick, etp]);

  const step = steps[Math.min(i, steps.length - 1)];
  const prev = i > 0 ? steps[i - 1] : null;

  // reset on scenario change
  const resetKey = `${scenario}-${mode}-${pick}-${etp}`;
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      setI(0);
    }
  }, [resetKey]);

  // autoplay
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (i >= steps.length - 1) setPlaying(false);
      else setI((x) => x + 1);
    }, 2400);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);

  // packet tween along the step's path
  const [pos, setPos] = useState<[number, number]>([...P.a1]);
  const posRef = useRef<[number, number]>([...P.a1]);
  useEffect(() => {
    const pts: [number, number][] = [posRef.current, ...step.path.map((k) => [...P[k]] as [number, number])];
    const segs: number[] = [];
    let total = 0;
    for (let s = 1; s < pts.length; s++) {
      const d = dist(pts[s - 1], pts[s]);
      segs.push(d);
      total += d;
    }
    if (total < 1) {
      posRef.current = pts[pts.length - 1];
      setPos(pts[pts.length - 1]);
      return;
    }
    const dur = Math.min(1600, 350 + total * 1.6);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      let d = e * total;
      let s = 0;
      while (s < segs.length - 1 && d > segs[s]) {
        d -= segs[s];
        s++;
      }
      const f = segs[s] ? Math.min(1, d / segs[s]) : 1;
      const a = pts[s];
      const b = pts[s + 1];
      const p: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      posRef.current = p;
      setPos(p);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // visited trail
  const trail = useMemo(() => {
    const keys: PKey[] = [];
    for (let s = 0; s <= Math.min(i, steps.length - 1); s++) keys.push(...steps[s].path);
    return keys;
  }, [i, steps]);

  const hl = new Set(step.hl ?? []);
  const encap = !!step.outer;
  const showVx = scenario !== "same" && !(scenario === "cross" && mode === "native");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={scenario} options={SCENARIOS} onChange={(v) => { setScenario(v); setPlaying(false); }} />
        {scenario === "cross" && (
          <Segmented value={mode} options={[{ value: "overlay", label: "VXLAN overlay" }, { value: "native", label: "Native routing" }]} onChange={setMode} />
        )}
        {scenario === "svc" && (
          <Button variant="ghost" onClick={() => setPick(Math.random() < 0.5 ? "a2" : "b1")}>
            🎲 re-roll endpoint <Pill>{pick === "a2" ? "api-1" : "api-2"}</Pill>
          </Button>
        )}
        {scenario === "nodeport" && (
          <Segmented
            value={etp}
            options={[{ value: "Cluster", label: "externalTrafficPolicy: Cluster" }, { value: "Local", label: "Local" }]}
            onChange={setEtp}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-line bg-bg/60 p-2">
          <svg viewBox="0 0 740 412" className="h-auto w-full" role="img" aria-label="Two-node cluster topology with packet position">
            <defs>
              <filter id="pw-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <NodeBox x={15} label="node A" ip={IP.nodeA} cidr="podCIDR 10.244.1.0/24" />
            <NodeBox x={385} label="node B" ip={IP.nodeB} cidr="podCIDR 10.244.2.0/24" />

            {/* wires */}
            {(
              [
                ["a1", "vA1"], ["a2", "vA2"], ["vA1", "brA"], ["vA2", "brA"], ["brA", "nfA"], ["nfA", "ethA"],
                ["b1", "vB1"], ["dns", "vDns"], ["vB1", "brB"], ["vDns", "brB"], ["brB", "nfB"], ["nfB", "ethB"],
                ["ethA", "sw"], ["ethB", "sw"], ["sw", "ext"],
                ...(showVx ? ([["nfA", "vxA"], ["vxA", "ethA"], ["nfB", "vxB"], ["vxB", "ethB"]] as const) : []),
              ] as const
            ).map(([a, b]) => {
              const on = trail.includes(a) && trail.includes(b);
              return (
                <line
                  key={a + b}
                  x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]}
                  stroke={on ? "var(--color-accent)" : "var(--color-line)"}
                  strokeWidth={on ? 2 : 1.5}
                  strokeDasharray={on ? "6 6" : undefined}
                  className={on ? "animate-dash" : undefined}
                />
              );
            })}

            <Pod k="a1" name="web-1" ip={IP.a1} hl={hl} color="var(--color-f1)" />
            <Pod k="a2" name="api-1" ip={IP.a2} hl={hl} color="var(--color-f2)" />
            <Pod k="b1" name="api-2" ip={IP.b1} hl={hl} color="var(--color-f2)" />
            <Pod k="dns" name="coredns" ip={IP.dns} hl={hl} color="var(--color-f4)" />
            {(["vA1", "vA2", "vB1", "vDns"] as const).map((k) => (
              <g key={k}>
                <rect x={P[k][0] - 22} y={P[k][1] - 8} width={44} height={16} rx={8} fill="var(--color-panel-2)" stroke={hl.has(k) ? "var(--color-accent)" : "var(--color-line)"} />
                <text x={P[k][0]} y={P[k][1] + 3.5} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">veth</text>
              </g>
            ))}
            <Box k="brA" w={200} label="cni0 bridge  10.244.1.1" hl={hl} />
            <Box k="brB" w={200} label="cni0 bridge  10.244.2.1" hl={hl} />
            <Box k="nfA" w={156} label="routing + netfilter" hl={hl} tone={scenario === "svc" || scenario === "nodeport" || scenario === "dns" ? "k8s" : undefined} />
            <Box k="nfB" w={156} label="routing + netfilter" hl={hl} tone={scenario === "nodeport" ? "k8s" : undefined} />
            {showVx && <Box k="vxA" w={86} label="flannel.1" hl={hl} tone="vx" />}
            {showVx && <Box k="vxB" w={86} label="flannel.1" hl={hl} tone="vx" />}
            <Box k="ethA" w={140} label={`eth0 ${IP.nodeA}`} hl={hl} />
            <Box k="ethB" w={140} label={`eth0 ${IP.nodeB}`} hl={hl} />
            <Box k="sw" w={180} label="underlay 192.168.1.0/24" hl={hl} />
            <Box k="ext" w={180} label={`client ${IP.client}`} hl={hl} dim={scenario !== "nodeport"} />

            {/* the packet */}
            <g transform={`translate(${pos[0]} ${pos[1]})`} filter="url(#pw-glow)">
              {encap && <rect x={-13} y={-10} width={26} height={20} rx={4} fill="none" stroke="var(--color-f6)" strokeWidth={2} />}
              <rect x={-8} y={-6} width={16} height={12} rx={2.5} fill={step.verdict === "bad" ? "var(--color-bad)" : "var(--color-accent)"} />
            </g>
          </svg>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[11px] text-faint">
              step {Math.min(i, steps.length - 1) + 1}/{steps.length}
            </div>
            <div className="flex gap-1.5">
              <Button variant="ghost" onClick={() => { setPlaying(false); setI(0); }} disabled={i === 0}>⟲</Button>
              <Button onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} disabled={i === 0}>Prev</Button>
              <Button onClick={() => { setPlaying(false); setI((x) => Math.min(steps.length - 1, x + 1)); }} disabled={i >= steps.length - 1}>Next</Button>
              <Button variant="primary" onClick={() => { if (i >= steps.length - 1) setI(0); setPlaying((p) => !p); }}>
                {playing ? "Pause" : "▶ Play"}
              </Button>
            </div>
          </div>
          <div className="flex gap-1" aria-hidden>
            {steps.map((_, s) => (
              <button key={s} type="button" onClick={() => setI(s)} className={clsx("h-1 flex-1 rounded-full transition", s <= i ? "bg-accent" : "bg-line")} aria-label={`go to step ${s + 1}`} />
            ))}
          </div>

          <div key={`${resetKey}-${i}`} className="animate-rise">
            <h3 className={clsx("text-[15px] font-semibold", step.verdict === "bad" && "text-bad", step.verdict === "ok" && "text-ok")}>{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
          </div>

          <HeaderCard step={step} prev={prev} />

          {step.code && (
            <div className="overflow-hidden rounded-lg border border-line bg-bg">
              <div className="border-b border-line px-3 py-1 font-mono text-[10.5px] text-faint">{step.code.title}</div>
              <div className="overflow-x-auto py-1.5">
                {step.code.lines.map((l, n) => (
                  <div
                    key={n}
                    className={clsx(
                      "px-3 font-mono text-[11px] leading-relaxed whitespace-pre transition-colors",
                      step.code!.hl?.includes(n) ? "bg-accent/10 text-ink" : "text-muted",
                    )}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeBox({ x, label, ip, cidr }: { x: number; label: string; ip: string; cidr: string }) {
  return (
    <g>
      <rect x={x} y={20} width={340} height={290} rx={14} fill="var(--color-panel)" stroke="var(--color-line)" />
      <text x={x + 12} y={36} fontSize={11} fill="var(--color-ink)" fontWeight={600}>
        {label}
      </text>
      <text x={x + 62} y={36} fontSize={9.5} fill="var(--color-faint)" fontFamily="var(--font-mono)">
        {ip} · {cidr}
      </text>
    </g>
  );
}

function Pod({ k, name, ip, hl, color }: { k: PKey; name: string; ip: string; hl: Set<PKey>; color: string }) {
  const [x, y] = P[k];
  const on = hl.has(k);
  return (
    <g>
      <rect
        x={x - 58} y={y - 22} width={116} height={42} rx={9}
        fill={`color-mix(in srgb, ${color} ${on ? 22 : 10}%, var(--color-panel-2))`}
        stroke={on ? "var(--color-accent)" : `color-mix(in srgb, ${color} 50%, transparent)`}
        strokeWidth={on ? 2 : 1}
        style={{ transition: "all 300ms" }}
      />
      <text x={x} y={y - 4} textAnchor="middle" fontSize={12.5} fill="var(--color-ink)" fontWeight={600}>
        {name}
      </text>
      <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill={color} fontFamily="var(--font-mono)">
        {ip}
      </text>
    </g>
  );
}

function Box({ k, w, label, hl, tone, dim }: { k: PKey; w: number; label: string; hl: Set<PKey>; tone?: "k8s" | "vx"; dim?: boolean }) {
  const [x, y] = P[k];
  const on = hl.has(k);
  const stroke = on ? "var(--color-accent)" : tone === "k8s" ? "var(--color-accent-2)" : tone === "vx" ? "var(--color-f6)" : "var(--color-line)";
  return (
    <g opacity={dim ? 0.35 : 1} style={{ transition: "opacity 300ms" }}>
      <rect x={x - w / 2} y={y - 12} width={w} height={24} rx={6} fill="var(--color-panel-2)" stroke={stroke} strokeWidth={on ? 2 : 1} style={{ transition: "all 300ms" }} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill={on ? "var(--color-ink)" : "var(--color-muted)"} fontFamily="var(--font-mono)">
        {label}
      </text>
    </g>
  );
}

function Field({ label, value, changed }: { label: string; value: string; changed: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] tracking-wide text-faint uppercase">{label}</div>
      <div key={value} className={clsx("truncate rounded px-1 font-mono text-[12px]", changed ? "animate-flash text-accent" : "text-ink")} title={value}>
        {value}
      </div>
    </div>
  );
}

function HeaderCard({ step, prev }: { step: Step; prev: Step | null }) {
  const o = step.outer;
  return (
    <div className="space-y-1.5" aria-live="polite">
      {o && (
        <div className="animate-rise rounded-lg border border-f6/50 bg-f6/5 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10.5px] text-f6">outer header (encapsulation)</span>
            <Pill color="var(--color-f6)">{o.info}</Pill>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="src" value={o.src} changed={!prev?.outer || prev.outer.src !== o.src} />
            <Field label="dst" value={o.dst} changed={!prev?.outer || prev.outer.dst !== o.dst} />
            <Field label="proto" value={o.proto ?? ""} changed={false} />
          </div>
        </div>
      )}
      <div className={clsx("rounded-lg border p-2.5", o ? "ml-3 border-line bg-panel-2/40" : "border-accent/40 bg-accent/5")}>
        <div className="mb-1 font-mono text-[10.5px] text-accent">{o ? "inner (pod) packet" : "IP packet"}</div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="src" value={step.pkt.src} changed={!!prev && prev.pkt.src !== step.pkt.src} />
          <Field label="dst" value={step.pkt.dst} changed={!!prev && prev.pkt.dst !== step.pkt.dst} />
          <Field label="proto" value={step.pkt.proto ?? ""} changed={false} />
        </div>
      </div>
    </div>
  );
}
