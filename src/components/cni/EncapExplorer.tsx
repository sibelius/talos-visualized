"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout, Segmented, Slider, Stat, Toggle } from "../ui";

type Mode = "native" | "vxlan" | "geneve" | "ipip" | "wireguard";
type Seg = { label: string; bytes: number; color: string; note: string };

const MODES: { value: Mode; label: string }[] = [
  { value: "native", label: "Native (BGP)" },
  { value: "vxlan", label: "VXLAN" },
  { value: "geneve", label: "Geneve" },
  { value: "ipip", label: "IP-in-IP" },
  { value: "wireguard", label: "WireGuard" },
];

const ABOUT: Record<Mode, { who: string; why: string }> = {
  native: {
    who: "Calico BGP, Cilium native-routing + BGP, kube-router, Flannel host-gw",
    why: "No wrapper: the underlay routes pod CIDRs directly. Zero overhead and real pod IPs on the wire, but your routers (or a shared L2 segment) must know every node's podCIDR.",
  },
  vxlan: {
    who: "Flannel (Talos default), Cilium default, Calico VXLAN mode",
    why: "Wraps the whole L2 frame in UDP. Works on any IP network, crosses routers and most cloud fabrics, and the UDP source port carries flow entropy for ECMP.",
  },
  geneve: {
    who: "Cilium (tunnel-protocol: geneve), OVN / Kube-OVN, Antrea default",
    why: "Like VXLAN but with extensible TLV options — Cilium can carry metadata, OVN encodes logical ports. Same 50 B base cost plus any options.",
  },
  ipip: {
    who: "Calico IPIP mode",
    why: "Smallest tunnel: just a second IPv4 header (IP protocol 4). No UDP means less ECMP entropy, and some clouds (e.g. Azure) drop protocol 4 entirely.",
  },
  wireguard: {
    who: "Cilium & Calico transparent encryption, Flannel wireguard backend",
    why: "Encrypts node-to-node traffic with a modern, in-kernel cipher suite. It's a tunnel too: UDP + WireGuard header + 16 B auth tag around the inner IP packet.",
  },
};

function segs(mode: Mode, v6: boolean, geneveOpts: number): Seg[] {
  const oip: Seg = { label: v6 ? "outer IPv6" : "outer IPv4", bytes: v6 ? 40 : 20, color: "var(--color-f6)", note: "node → node addresses" };
  const udp = (port: number): Seg => ({ label: "UDP", bytes: 8, color: "var(--color-f4)", note: `dst port ${port}` });
  const ieth: Seg = { label: "inner Eth", bytes: 14, color: "var(--color-f3)", note: "original L2 frame header" };
  switch (mode) {
    case "native":
      return [];
    case "vxlan":
      return [oip, udp(8472), { label: "VXLAN", bytes: 8, color: "var(--color-f5)", note: "24-bit VNI" }, ieth];
    case "geneve":
      return [oip, udp(6081), { label: "Geneve", bytes: 8 + geneveOpts, color: "var(--color-f5)", note: `VNI + ${geneveOpts} B options` }, ieth];
    case "ipip":
      return [{ ...oip, note: "IP proto 4 — no UDP" }];
    case "wireguard":
      return [oip, { ...udp(51871), note: "Cilium 51871 · Calico 51820" }, { label: "WG hdr", bytes: 16, color: "var(--color-f5)", note: "type, receiver idx, counter" }, { label: "auth tag", bytes: 16, color: "var(--color-bad)", note: "Poly1305 (trailer)" }];
  }
}

export function EncapExplorer() {
  const [mode, setMode] = useState<Mode>("vxlan");
  const [mtu, setMtu] = useState(1500);
  const [v6, setV6] = useState(false);
  const [opts, setOpts] = useState(0);
  const [wrongMtu, setWrongMtu] = useState(false);

  const s = segs(mode, v6, opts);
  const overhead = s.reduce((a, x) => a + x.bytes, 0);
  const podMtu = mtu - overhead;
  const innerIp = 20;
  const mss = podMtu - innerIp - 20;
  const eff = (mss / (mtu + 14 + 4)) * 100; // payload / (frame incl. eth hdr + FCS)
  const sentInner = wrongMtu ? mtu : podMtu;
  const onWire = sentInner + overhead;
  const tooBig = onWire > mtu;

  // header zoom: scale so 120 B fill the bar
  const ZOOM = 120;
  const headerStack: Seg[] = [
    ...s.filter((x) => x.label !== "auth tag"),
    { label: "inner IP", bytes: innerIp, color: "var(--color-accent)", note: "pod → pod" },
    { label: "TCP", bytes: 20, color: "var(--color-ok)", note: "app transport" },
  ];
  const trailer = s.find((x) => x.label === "auth tag");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Segmented value={mode} options={MODES} onChange={setMode} />
        <Slider label="underlay MTU" value={mtu} min={1280} max={9000} step={10} onChange={setMtu} format={(v) => `${v}`} />
        <Toggle checked={v6} onChange={setV6} label="IPv6 underlay" />
        {mode === "geneve" && <Slider label="Geneve options" value={opts} min={0} max={32} step={4} onChange={setOpts} format={(v) => `${v} B`} />}
      </div>

      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-faint">
          <span>header stack (zoomed: bar = {ZOOM} bytes)</span>
          <span>overhead {overhead} B</span>
        </div>
        <div className="flex h-14 w-full overflow-hidden rounded-lg border border-line">
          {headerStack.map((x, n) => (
            <div
              key={x.label + n}
              title={`${x.label}: ${x.bytes} B — ${x.note}`}
              className="flex min-w-0 flex-col items-center justify-center border-r border-bg/70 px-0.5 text-center transition-all duration-500"
              style={{ width: `${(x.bytes / ZOOM) * 100}%`, background: `color-mix(in srgb, ${x.color} 28%, var(--color-panel-2))` }}
            >
              <span className="truncate text-[10.5px] font-medium text-ink">{x.label}</span>
              <span className="font-mono text-[10px]" style={{ color: x.color }}>{x.bytes}</span>
            </div>
          ))}
          <div className="flex flex-1 items-center justify-center bg-panel-2 font-mono text-[10.5px] text-muted">payload →</div>
          {trailer && (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{ width: `${(trailer.bytes / ZOOM) * 100}%`, background: "color-mix(in srgb, var(--color-bad) 28%, var(--color-panel-2))" }}
              title="Poly1305 tag, appended after the payload"
            >
              <span className="text-[10px] text-ink">tag</span>
              <span className="font-mono text-[10px] text-bad">16</span>
            </div>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
          {s.length === 0 ? (
            <span>No encapsulation: the pod&apos;s IP header is the outermost header.</span>
          ) : (
            s.map((x) => (
              <span key={x.label}>
                <span style={{ color: x.color }}>■</span> {x.label}: {x.note}
              </span>
            ))
          )}
        </div>

        <div className="mt-5 mb-2 flex items-center justify-between font-mono text-[11px] text-faint">
          <span>one full-size packet, true scale ({mtu} B underlay MTU)</span>
          <span className={tooBig ? "text-bad" : "text-ok"}>{onWire} B on the wire</span>
        </div>
        <div className="relative h-7 w-full rounded-md border border-line bg-panel-2">
          <div
            className={clsx("absolute inset-y-0 left-0 flex rounded-md transition-all duration-500", tooBig && "animate-pulse-soft")}
            style={{ width: `${Math.min(100, (onWire / mtu) * 100)}%` }}
          >
            <div style={{ width: `${(overhead / onWire) * 100}%` }} className="bg-f6/70" />
            <div className="flex-1 bg-accent/50" />
          </div>
          {tooBig && <div className="absolute inset-y-0 right-0 flex items-center pr-2 font-mono text-[11px] text-bad">+{onWire - mtu} B doesn&apos;t fit</div>}
        </div>
        <div className="mt-3">
          <Toggle checked={wrongMtu} onChange={setWrongMtu} label={<>Mistake: leave the pod MTU at {mtu} (ignore overhead)</>} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="overhead" value={`${overhead} B`} tone={overhead === 0 ? "good" : overhead > 55 ? "warn" : "neutral"} />
        <Stat label="pod MTU" value={podMtu} />
        <Stat label="TCP MSS" value={mss} />
        <Stat label="payload efficiency" value={`${eff.toFixed(1)}%`} tone={eff > 95 ? "good" : "neutral"} />
      </div>

      {tooBig ? (
        <Callout tone="bad" title="Path-MTU black hole">
          A {sentInner} B pod packet becomes {onWire} B after encapsulation. Tunnel packets usually carry DF, so the kernel
          drops it and sends ICMP &quot;fragmentation needed&quot; — which firewalls often eat. Symptom: TCP handshakes and
          small requests work, large responses hang. CNIs avoid this by setting the pod MTU to underlay − overhead.
        </Callout>
      ) : (
        <Callout tone="info" title={MODES.find((m) => m.value === mode)!.label}>
          {ABOUT[mode].why} <span className="text-faint">Used by: {ABOUT[mode].who}.</span>
          {mtu >= 9000 && mode !== "native" && <> With jumbo frames the overhead almost disappears ({((overhead / mtu) * 100).toFixed(2)}%).</>}
        </Callout>
      )}
    </div>
  );
}
