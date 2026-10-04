"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Segmented, Toggle } from "../ui";

type Mode = "vip" | "lb" | "dns";
const CPS = [
  { name: "cp-1", ip: "10.0.0.10", y: 40 },
  { name: "cp-2", ip: "10.0.0.11", y: 130 },
  { name: "cp-3", ip: "10.0.0.12", y: 220 },
];
const CPX = 520;
const EP = { x: 300, y: 100 };

const INFO: Record<Mode, { endpoint: string; box: string; sub: string; pros: string; cons: string }> = {
  vip: {
    endpoint: "https://10.0.0.5:6443",
    box: "VIP 10.0.0.5",
    sub: "Layer-2, held by one CP",
    pros: "Built in: no extra machines. Control planes elect an owner, which answers ARP for the VIP.",
    cons: "All CPs must share an L2 segment. The election goes through etcd, so the VIP can't move without quorum. Failover takes a few seconds or more. Don't use it as your talosctl endpoint.",
  },
  lb: {
    endpoint: "https://k8s-lb.example:6443",
    box: "load balancer",
    sub: "health-checks /readyz",
    pros: "Fast failover, spreads load across all API servers, works across subnets and clouds.",
    cons: "Another component to run and make HA (HAProxy+keepalived, cloud LB, MetalLB outside the cluster…).",
  },
  dns: {
    endpoint: "https://k8s.example:6443",
    box: "DNS: 3 A records",
    sub: "k8s.example → .10 .11 .12",
    pros: "No moving parts beyond DNS. Good enough for labs and for clients that retry.",
    cons: "Clients cache records and may keep trying a dead IP until TTL expiry or a retry picks another.",
  },
};

export function EndpointOptions() {
  const [mode, setMode] = useState<Mode>("vip");
  const [down, setDown] = useState([false, false, false]);
  const [owner, setOwner] = useState(0);
  const [moving, setMoving] = useState(false);
  const [prism, setPrism] = useState(true);
  const healthy = down.filter((d) => !d).length;
  const quorum = healthy >= 2;

  // VIP failover: needs etcd quorum to elect a new owner
  useEffect(() => {
    if (mode !== "vip" || !down[owner]) return;
    if (!quorum) {
      setMoving(false);
      return;
    }
    setMoving(true);
    const t = setTimeout(() => {
      setOwner(down.findIndex((d) => !d));
      setMoving(false);
    }, 1800);
    return () => clearTimeout(t);
  }, [mode, down, owner, quorum]);

  const info = INFO[mode];
  const ownerOk = !down[owner];

  // where does a request through the shared endpoint go?
  const viaEndpoint: number[] = mode === "vip" ? (ownerOk ? [owner] : []) : [0, 1, 2].filter((i) => mode === "dns" || !down[i]);
  const extOk = mode === "dns" ? healthy > 0 : viaEndpoint.length > 0;
  const prismTargets = [0, 1, 2].filter((i) => !down[i]);
  const apiAlive = quorum; // API servers need etcd to serve writes

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Mode>
          value={mode}
          options={[
            { value: "vip", label: "shared VIP" },
            { value: "lb", label: "external LB" },
            { value: "dns", label: "DNS round-robin" },
          ]}
          onChange={(m) => {
            setMode(m);
            setDown([false, false, false]);
            setOwner(0);
          }}
        />
        <Toggle checked={prism} onChange={setPrism} label="KubePrism on worker" />
        <Button variant="ghost" onClick={() => setDown([false, false, false])}>
          Heal all
        </Button>
      </div>
      <div className="font-mono text-[12px] text-muted">
        cluster.controlPlane.endpoint: <span className="text-accent">{info.endpoint}</span>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox="0 0 640 290" className="mx-auto w-full max-w-[820px] min-w-[520px]" role="img" aria-label={`API endpoint via ${info.box}`}>
          {/* external client → endpoint */}
          <Link x1={110} y1={60} x2={EP.x - 70} y2={EP.y} on={extOk} />
          {/* endpoint → cps */}
          {CPS.map((c, i) =>
            mode === "vip" ? null : (
              <Link key={i} x1={EP.x + 70} y1={EP.y} x2={CPX - 60} y2={c.y} on={viaEndpoint.includes(i) && !down[i]} broken={down[i]} />
            ),
          )}
          {mode === "vip" && <Link x1={EP.x + 70} y1={EP.y} x2={CPX - 60} y2={CPS[owner].y} on={ownerOk} broken={!ownerOk} />}

          {/* worker → api */}
          {prism
            ? CPS.map((c, i) => <Link key={i} x1={194} y1={254} x2={CPX - 60} y2={c.y + 6} on={prismTargets.includes(i)} broken={down[i]} color="var(--color-f4)" />)
            : <Link x1={150} y1={215} x2={EP.x - 40} y2={EP.y + 22} on={extOk} />}

          {/* external client */}
          <rect x={10} y={36} width={100} height={48} rx={9} fill="var(--color-panel-2)" stroke="var(--color-line)" />
          <text x={60} y={57} textAnchor="middle" className="fill-ink font-mono text-[11px]">kubectl</text>
          <text x={60} y={72} textAnchor="middle" className="fill-faint text-[9.5px]">outside</text>

          {/* endpoint */}
          <rect
            x={EP.x - 70}
            y={EP.y - 26}
            width={140}
            height={52}
            rx={10}
            fill="var(--color-panel-2)"
            stroke={extOk ? "var(--color-accent)" : "var(--color-bad)"}
            strokeDasharray={mode === "dns" ? "4 3" : undefined}
          />
          <text x={EP.x} y={EP.y - 4} textAnchor="middle" className="fill-ink font-mono text-[11px]">{info.box}</text>
          <text x={EP.x} y={EP.y + 12} textAnchor="middle" className="fill-faint text-[9.5px]">
            {mode === "vip" && moving ? "re-electing owner…" : mode === "vip" && !ownerOk && !quorum ? "stuck: no etcd quorum" : info.sub}
          </text>

          {/* worker */}
          <rect x={10} y={200} width={190} height={74} rx={10} fill="var(--color-panel)" stroke="var(--color-line)" />
          <text x={20} y={218} className="fill-ink text-[11px]">worker-1</text>
          <text x={20} y={236} className="fill-faint font-mono text-[9.5px]">kubelet · cilium · pods</text>
          {prism && (
            <g>
              <rect x={114} y={242} width={80} height={24} rx={6} fill="color-mix(in srgb, var(--color-f4) 18%, var(--color-panel-2))" stroke="var(--color-f4)" />
              <text x={154} y={258} textAnchor="middle" className="fill-ink font-mono text-[9.5px]">KubePrism</text>
            </g>
          )}
          <text x={20} y={258} className="fill-faint font-mono text-[9.5px]">{prism ? "→ localhost:7445" : `→ ${info.endpoint.replace("https://", "")}`}</text>

          {/* control planes */}
          {CPS.map((c, i) => {
            const isOwner = mode === "vip" && owner === i;
            return (
              <g
                key={c.name}
                role="button"
                tabIndex={0}
                aria-label={`${c.name} ${down[i] ? "down, click to recover" : "up, click to fail"}`}
                className="cursor-pointer outline-none"
                onClick={() => setDown((d) => d.map((v, k) => (k === i ? !v : v)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setDown((d) => d.map((v, k) => (k === i ? !v : v)));
                }}
              >
                <rect
                  x={CPX - 60}
                  y={c.y - 26}
                  width={150}
                  height={58}
                  rx={10}
                  fill={down[i] ? "color-mix(in srgb, var(--color-bad) 15%, var(--color-panel))" : "var(--color-panel)"}
                  stroke={down[i] ? "var(--color-bad)" : isOwner ? "var(--color-accent)" : "var(--color-line)"}
                  strokeWidth={isOwner ? 2 : 1}
                  style={{ transition: "all 250ms" }}
                />
                <text x={CPX - 48} y={c.y - 8} className="fill-ink text-[11px]">{c.name}</text>
                <text x={CPX + 80} y={c.y - 8} textAnchor="end" className="fill-faint font-mono text-[9.5px]">{c.ip}</text>
                <text x={CPX - 48} y={c.y + 10} className={clsx("font-mono text-[9.5px]", down[i] ? "fill-bad" : apiAlive ? "fill-ok" : "fill-warn")}>
                  {down[i] ? "powered off" : apiAlive ? "apiserver :6443 ✓" : "apiserver: no etcd quorum"}
                </text>
                {isOwner && !down[i] && (
                  <text x={CPX - 48} y={c.y + 24} className="fill-accent font-mono text-[9px]">
                    owns 10.0.0.5
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-center text-[12px] text-faint">Click a control plane to power it off.</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-ok/30 p-3 text-sm text-muted">
          <span className="mb-1 block text-[11px] tracking-wide text-ok uppercase">good</span>
          {info.pros}
        </div>
        <div className="rounded-lg border border-warn/30 p-3 text-sm text-muted">
          <span className="mb-1 block text-[11px] tracking-wide text-warn uppercase">watch out</span>
          {info.cons}
        </div>
      </div>
      <p className={clsx("rounded-lg border p-3 text-sm", prism ? "border-f4/40 text-muted" : "border-line text-faint")}>
        {prism
          ? "KubePrism (on by default) runs a small TCP load balancer on every node at localhost:7445 that spreads connections over all known API servers. In-cluster, host-level clients keep working even if the external endpoint is down or the VIP is moving."
          : "Without KubePrism, every component on the node depends on the shared endpoint: if the VIP is mid-failover or the LB is down, kubelets and the CNI lose the API too."}
      </p>
    </div>
  );
}

function Link({ x1, y1, x2, y2, on, broken, color = "var(--color-accent)" }: { x1: number; y1: number; x2: number; y2: number; on: boolean; broken?: boolean; color?: string }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={broken ? "var(--color-bad)" : on ? color : "var(--color-faint)"}
      strokeOpacity={on ? 0.9 : 0.35}
      strokeWidth={on ? 1.8 : 1}
      strokeDasharray="6 6"
      className={on ? "animate-dash" : undefined}
    />
  );
}
