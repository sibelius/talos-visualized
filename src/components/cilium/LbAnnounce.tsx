"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Segmented } from "../ui";

const NODES = [
  { name: "worker-1", ip: "192.168.1.21", x: 110 },
  { name: "worker-2", ip: "192.168.1.22", x: 300 },
  { name: "worker-3", ip: "192.168.1.23", x: 490 },
];
const VIP = "192.168.1.240";

export function LbAnnounce() {
  const [mode, setMode] = useState<"l2" | "bgp">("l2");
  const [down, setDown] = useState<Set<number>>(new Set());
  const [leader, setLeader] = useState(1);
  const [electing, setElecting] = useState(false);
  const [clock, setClock] = useState(0);

  // traffic animation: one packet every 700ms, round-robin over announcing nodes
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      setClock(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const tick = Math.floor(clock / 700);
  const phase = (clock % 700) / 700;

  // L2: leader lost → lease expires → another node wins
  useEffect(() => {
    if (mode !== "l2" || !down.has(leader)) return;
    setElecting(true);
    const t = setTimeout(() => {
      const next = NODES.findIndex((_, i) => !down.has(i));
      if (next >= 0) setLeader(next);
      setElecting(false);
    }, 2200);
    return () => clearTimeout(t);
  }, [mode, down, leader]);

  const toggle = (i: number) =>
    setDown((d) => {
      const n = new Set(d);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const up = NODES.map((_, i) => i).filter((i) => !down.has(i));
  const active = mode === "l2" ? (electing || down.has(leader) ? [] : [leader]) : up;
  const pulse = active.length ? active[tick % active.length] : -1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} options={[{ value: "l2", label: "L2 announcements (ARP)" }, { value: "bgp", label: "BGP control plane" }]} onChange={(m) => { setMode(m); setDown(new Set()); }} />
        <span className="text-xs text-faint">click a node to fail / recover it</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-line bg-bg/60 p-2">
          <svg viewBox="0 0 600 270" className="h-auto w-full" role="img" aria-label="LoadBalancer IP announcement topology">
            {/* router / client */}
            <rect x={210} y={14} width={180} height={44} rx={10} fill="var(--color-panel-2)" stroke="var(--color-line)" />
            <text x={300} y={33} textAnchor="middle" fontSize={11} fill="var(--color-ink)" fontWeight={600}>
              {mode === "l2" ? "LAN clients / gateway" : "ToR router (AS 65000)"}
            </text>
            <text x={300} y={49} textAnchor="middle" fontSize={9.5} fill="var(--color-faint)" fontFamily="var(--font-mono)">
              {mode === "l2" ? `ARP: who-has ${VIP}?` : `${VIP}/32 ECMP × ${up.length}`}
            </text>
            {NODES.map((n, i) => {
              const isDown = down.has(i);
              const on = active.includes(i);
              return (
                <g key={n.name}>
                  <line
                    x1={300} y1={58} x2={n.x} y2={170}
                    stroke={on ? "var(--color-ok)" : "var(--color-line)"}
                    strokeWidth={on ? 2 : 1}
                    strokeDasharray={on ? "6 6" : "3 5"}
                    className={on ? "animate-dash" : undefined}
                    opacity={isDown ? 0.3 : 1}
                  />
                  {pulse === i && <circle cx={300 + (n.x - 300) * phase} cy={58 + 112 * phase} r={5} fill="var(--color-accent)" />}
                  {mode === "bgp" && !isDown && (
                    <text x={(300 + n.x) / 2 + (i === 1 ? 8 : i === 0 ? -10 : 10)} y={118} textAnchor={i === 0 ? "end" : "start"} fontSize={9} fill="var(--color-f6)" fontFamily="var(--font-mono)">
                      UPDATE {VIP}/32
                    </text>
                  )}
                  <g onClick={() => toggle(i)} className="cursor-pointer" role="button" aria-label={`${isDown ? "recover" : "fail"} ${n.name}`}>
                    <rect
                      x={n.x - 80} y={170} width={160} height={80} rx={12}
                      fill={isDown ? "color-mix(in srgb, var(--color-bad) 10%, var(--color-panel))" : "var(--color-panel)"}
                      stroke={isDown ? "var(--color-bad)" : on ? "var(--color-ok)" : "var(--color-line)"}
                      strokeWidth={on ? 2 : 1}
                      style={{ transition: "all 300ms" }}
                    />
                    <text x={n.x} y={190} textAnchor="middle" fontSize={11} fill={isDown ? "var(--color-bad)" : "var(--color-ink)"} fontWeight={600}>
                      {n.name} {isDown ? "✕ down" : ""}
                    </text>
                    <text x={n.x} y={205} textAnchor="middle" fontSize={9.5} fill="var(--color-faint)" fontFamily="var(--font-mono)">{n.ip}</text>
                    <text x={n.x} y={226} textAnchor="middle" fontSize={9.5} fill={on ? "var(--color-ok)" : "var(--color-faint)"} fontFamily="var(--font-mono)">
                      {mode === "l2"
                        ? isDown
                          ? "—"
                          : i === leader && !electing
                            ? "lease holder: answers ARP"
                            : electing
                              ? "contending for lease…"
                              : "standby"
                        : isDown
                          ? "session down, route withdrawn"
                          : "BGP peer · advertising"}
                    </text>
                    <text x={n.x} y={241} textAnchor="middle" fontSize={9} fill="var(--color-faint)" fontFamily="var(--font-mono)">cilium-agent</text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-muted">
          <p>
            A <span className="font-mono">type: LoadBalancer</span> Service gets <b className="text-ink">{VIP}</b> from a{" "}
            <span className="font-mono">CiliumLoadBalancerIPPool</span> (LB IPAM). Then something has to tell the network
            where that IP lives.
          </p>
          {mode === "l2" ? (
            <p>
              <b className="text-ink">L2 announcements:</b> nodes race for a Kubernetes <span className="font-mono">Lease</span> per
              Service; the holder answers ARP for the VIP, so <i>all</i> traffic enters through one node (then eBPF spreads it to
              backends). Kill the leader: the lease expires and another node takes over and sends gratuitous ARP — a few seconds
              of disruption. Perfect for a homelab / Proxmox LAN with no BGP router.
            </p>
          ) : (
            <p>
              <b className="text-ink">BGP:</b> every eligible node peers with the router and advertises the VIP as a /32. The
              router does ECMP across all of them, so ingress scales with node count. Fail a node and its session drops — the
              route is withdrawn (fast with BFD or short hold timers). Needs a BGP-capable router.
            </p>
          )}
          <div className={clsx("rounded-lg border p-2 font-mono text-[11px]", active.length ? "border-ok/40 text-ok" : "border-bad/50 text-bad animate-pulse-soft")}>
            {active.length
              ? `${VIP} reachable via ${active.map((i) => NODES[i].name).join(", ")}`
              : electing
                ? "leader lost — waiting for lease to expire…"
                : "no healthy node announces the VIP"}
          </div>
          {down.size > 0 && (
            <Button variant="ghost" onClick={() => setDown(new Set())}>
              recover all nodes
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
