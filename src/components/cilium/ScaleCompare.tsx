"use client";

import { useEffect, useState } from "react";
import { Slider, Stat } from "../ui";

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString());

/** slider position 0..100 → 10..20000 services (log) */
const toSvc = (p: number) => Math.round(10 * Math.pow(2000, p / 100));

export function ScaleCompare() {
  const [p, setP] = useState(50);
  const [eps, setEps] = useState(3);
  const services = toSvc(p);
  const rules = services * (2 + 3 * eps) + 10;
  const iptEval = Math.round(services / 2) + 3; // linear scan of KUBE-SERVICES, then SVC + SEP
  const bpfEval = 2; // service map lookup + backend map lookup

  // animated lookup: scan position in the iptables list, and a hash "jump"
  const [target, setTarget] = useState(0.6);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    let tgt = Math.random();
    setTarget(tgt);
    const tick = (now: number) => {
      const el = (now - start) / 2200;
      if (el >= 1) {
        start = now;
        tgt = 0.1 + Math.random() * 0.85;
        setTarget(tgt);
      }
      setT(Math.min(1, el % 1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const scanFrac = Math.min(target, t * 1.15); // scan reaches the target then stops
  const ROWS = 60;
  const bucket = Math.floor(target * 64);
  const jumped = t > 0.12;

  // chart
  const W = 480;
  const H = 180;
  const xs = Array.from({ length: 41 }, (_, k) => k * 2.5);
  const maxEval = toSvc(100) / 2 + 3;
  const ly = (v: number) => Math.round(10 * (H - 20 - ((Math.log10(v) + 0.5) / (Math.log10(maxEval) + 0.5)) * (H - 34))) / 10;
  const lx = (pp: number) => Math.round(10 * (30 + (pp / 100) * (W - 40))) / 10;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Slider label="Services" value={p} min={0} max={100} onChange={setP} format={() => fmt(services)} />
        <Slider label="endpoints / svc" value={eps} min={1} max={10} onChange={setEps} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg/60 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium">iptables (kube-proxy)</span>
            <span className="font-mono text-[11px] text-faint">KUBE-SERVICES: {fmt(services)} rules, scanned top-down</span>
          </div>
          <div className="relative h-56 overflow-hidden rounded-lg border border-line bg-panel-2/40" aria-label="iptables linear rule scan">
            {Array.from({ length: ROWS }, (_, r) => {
              const f = r / ROWS;
              const passed = f < scanFrac;
              const hit = Math.abs(f - target) < 1 / ROWS && scanFrac >= target - 0.001;
              return (
                <div
                  key={r}
                  className="absolute right-2 left-2 h-[2px] rounded-full"
                  style={{
                    top: `${(r / ROWS) * 100}%`,
                    marginTop: 1,
                    background: hit ? "var(--color-ok)" : passed ? "color-mix(in srgb, var(--color-bad) 70%, transparent)" : "var(--color-line)",
                    height: hit ? 4 : 2,
                  }}
                />
              );
            })}
            <div className="absolute right-2 bottom-1.5 rounded bg-bg/80 px-1.5 font-mono text-[10.5px] text-bad">
              {Math.round(scanFrac * services).toLocaleString()} rules checked
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium">eBPF (Cilium)</span>
            <span className="font-mono text-[11px] text-faint">hash map: key = (VIP, port, proto)</span>
          </div>
          <div className="relative grid h-56 grid-cols-8 gap-1 rounded-lg border border-line bg-panel-2/40 p-2" aria-label="eBPF hash map lookup">
            {Array.from({ length: 64 }, (_, b) => (
              <div
                key={b}
                className="rounded-sm transition-colors duration-200"
                style={{
                  background:
                    jumped && b === bucket
                      ? "var(--color-ok)"
                      : b < Math.min(64, Math.ceil((services / toSvc(100)) * 64) + 6)
                        ? "color-mix(in srgb, var(--color-f6) 22%, transparent)"
                        : "var(--color-line)",
                }}
              />
            ))}
            <div className="absolute right-2 bottom-1.5 rounded bg-bg/80 px-1.5 font-mono text-[10.5px] text-ok">hash → bucket {bucket} · 1 lookup</div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-2 gap-2 self-start">
          <Stat label="iptables nat rules" value={fmt(rules)} tone={rules > 50000 ? "bad" : rules > 5000 ? "warn" : "neutral"} />
          <Stat label="eBPF map entries" value={fmt(services * (1 + eps))} />
          <Stat label="iptables evals / new conn" value={fmt(iptEval)} tone={iptEval > 1000 ? "bad" : "neutral"} />
          <Stat label="eBPF lookups / new conn" value={bpfEval} tone="good" />
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-3">
          <div className="mb-1 font-mono text-[11px] text-faint">match cost per new connection vs #services (log y)</div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Linear iptables cost versus constant eBPF cost">
            <line x1={30} y1={H - 20} x2={W - 10} y2={H - 20} stroke="var(--color-line)" />
            <polyline fill="none" stroke="var(--color-bad)" strokeWidth={2} points={xs.map((x) => `${lx(x)},${ly(toSvc(x) / 2 + 3)}`).join(" ")} />
            <polyline fill="none" stroke="var(--color-warn)" strokeWidth={1.5} strokeDasharray="4 3" points={xs.map((x) => `${lx(x)},${ly(4)}`).join(" ")} />
            <polyline fill="none" stroke="var(--color-ok)" strokeWidth={2} points={xs.map((x) => `${lx(x)},${ly(2)}`).join(" ")} />
            <line x1={lx(p)} y1={8} x2={lx(p)} y2={H - 20} stroke="var(--color-accent)" strokeDasharray="3 3" />
            <circle cx={lx(p)} cy={ly(iptEval)} r={3.5} fill="var(--color-bad)" />
            <text x={34} y={16} fontSize={11} fill="var(--color-bad)">iptables O(n)</text>
            <text x={W - 12} y={ly(4) - 5} fontSize={10} textAnchor="end" fill="var(--color-warn)">nftables verdict map</text>
            <text x={36} y={ly(2) + 13} fontSize={10} fill="var(--color-ok)">eBPF hash O(1)</text>
            <text x={30} y={H - 5} fontSize={10} fill="var(--color-faint)">10 svc</text>
            <text x={W - 10} y={H - 5} fontSize={10} textAnchor="end" fill="var(--color-faint)">20k svc</text>
          </svg>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-faint">
        Only the first packet of a connection walks the chain — conntrack handles the rest — so the pain shows up as
        connection-setup latency, CPU on busy nodes, and slow rule syncs when Services churn. kube-proxy&apos;s nftables
        mode (GA in Kubernetes 1.33) also fixes the O(n) match with verdict maps; eBPF additionally bypasses netfilter altogether,
        keeping its own connection tracking in BPF maps.
      </p>
    </div>
  );
}
