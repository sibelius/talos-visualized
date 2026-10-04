"use client";

import { useEffect, useState } from "react";

const CPS = [
  { x: 210, name: "cp-1" },
  { x: 370, name: "cp-2" },
  { x: 530, name: "cp-3" },
];
const WS = [
  { x: 270, name: "worker-1" },
  { x: 490, name: "worker-2" },
];
const CP_Y = 24;
const W_Y = 176;

// packet routes
const API_PATHS = [
  "M132,152 C175,152 185,61 220,61",
  "M110,130 C130,4 350,0 408,24",
  "M120,130 C150,-12 520,-10 568,24",
  "M132,172 C200,176 240,213 270,213",
  "M120,190 C200,330 450,300 525,242",
];
const CNI_PATH = "M410,222 C440,268 600,268 630,222";
const CSI_PATHS = ["M355,242 L355,297", "M575,242 L575,297"];

export function TalosHero() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 760 340"
        className="mx-auto w-full max-w-[900px] min-w-[520px]"
        role="img"
        aria-label="talosctl talks to apid on three control planes and two workers; pods talk across the CNI; volumes attach through CSI"
      >
        {/* etcd ring between CPs */}
        <path
          d={`M${CPS[0].x + 120},${CP_Y + 52} L${CPS[1].x + 20},${CP_Y + 52} M${CPS[1].x + 120},${CP_Y + 52} L${CPS[2].x + 20},${CP_Y + 52}`}
          stroke="var(--color-f4)"
          strokeOpacity={0.6}
          strokeDasharray="4 4"
          className="animate-dash"
          fill="none"
        />
        {/* API paths */}
        {API_PATHS.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--color-accent)" strokeOpacity={0.22} strokeDasharray="6 6" className="animate-dash" />
        ))}
        {/* kubelet → apiserver (via KubePrism) */}
        {WS.map((w) => (
          <path
            key={w.name}
            d={`M${w.x + 80},${W_Y} C${w.x + 80},${W_Y - 40} ${CPS[1].x + 70},${CP_Y + 110} ${CPS[1].x + 70},${CP_Y + 72}`}
            fill="none"
            stroke="var(--color-accent-2)"
            strokeOpacity={0.35}
            strokeDasharray="3 5"
          />
        ))}

        {/* talosctl */}
        <g>
          <rect x={14} y={130} width={118} height={60} rx={12} fill="var(--color-panel-2)" stroke="var(--color-accent)" strokeOpacity={0.6} />
          <text x={73} y={156} textAnchor="middle" className="fill-ink font-mono text-[13px]">talosctl</text>
          <text x={73} y={174} textAnchor="middle" className="fill-faint text-[10px]">gRPC · mTLS</text>
        </g>

        {/* control planes */}
        {CPS.map((c) => (
          <g key={c.name}>
            <rect x={c.x} y={CP_Y} width={140} height={72} rx={12} fill="var(--color-panel)" stroke="var(--color-line)" />
            <text x={c.x + 12} y={CP_Y + 18} className="fill-ink text-[11px] font-medium">{c.name}</text>
            <text x={c.x + 128} y={CP_Y + 18} textAnchor="end" className="fill-faint text-[9px]">control plane</text>
            <Chip x={c.x + 10} y={CP_Y + 28} w={56} label="apid" color="var(--color-accent)" />
            <Chip x={c.x + 72} y={CP_Y + 28} w={58} label="apiserver" color="var(--color-accent-2)" />
            <Chip x={c.x + 41} y={CP_Y + 50} w={58} label="etcd" color="var(--color-f4)" small />
          </g>
        ))}

        {/* CNI band */}
        <rect x={250} y={W_Y - 10} width={460} height={100} rx={16} fill="color-mix(in srgb, var(--color-f2) 5%, transparent)" stroke="var(--color-f2)" strokeOpacity={0.25} strokeDasharray="5 5" />
        <text x={700} y={W_Y + 84} textAnchor="end" className="fill-f2 font-mono text-[9.5px]" opacity={0.8}>CNI · pod network</text>
        <path d={CNI_PATH} fill="none" stroke="var(--color-f2)" strokeOpacity={0.5} strokeDasharray="5 5" className="animate-dash" />

        {/* workers */}
        {WS.map((w) => (
          <g key={w.name}>
            <rect x={w.x} y={W_Y} width={170} height={66} rx={12} fill="var(--color-panel)" stroke="var(--color-line)" />
            <text x={w.x + 12} y={W_Y + 18} className="fill-ink text-[11px] font-medium">{w.name}</text>
            <Chip x={w.x + 10} y={W_Y + 28} w={50} label="apid" color="var(--color-accent)" />
            <Chip x={w.x + 64} y={W_Y + 28} w={50} label="kubelet" color="var(--color-accent-2)" />
            {[0, 1].map((k) => (
              <g key={k}>
                <rect x={w.x + 122 + k * 20} y={W_Y + 30} width={16} height={16} rx={4} fill="color-mix(in srgb, var(--color-f2) 30%, var(--color-panel-2))" stroke="var(--color-f2)" />
              </g>
            ))}
            <text x={w.x + 140} y={W_Y + 58} textAnchor="middle" className="fill-faint text-[8.5px]">pods</text>
          </g>
        ))}

        {/* CSI volumes */}
        {CSI_PATHS.map((d) => (
          <path key={d} d={d} stroke="var(--color-f3)" strokeOpacity={0.55} strokeDasharray="3 4" className="animate-dash" />
        ))}
        {[355, 575].map((x) => (
          <Cylinder key={x} x={x} y={302} />
        ))}
        <text x={600} y={322} className="fill-f3 font-mono text-[9.5px]" opacity={0.85}>CSI volumes</text>

        {/* packets */}
        {!reduced && (
          <>
            {API_PATHS.map((d, i) => (
              <circle key={d} r={3.5} fill="var(--color-accent)">
                <animateMotion dur="2.6s" begin={`-${i * 0.52}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))}
            {[0, 1.1].map((b) => (
              <circle key={b} r={3.5} fill="var(--color-f2)">
                <animateMotion dur="2.2s" begin={`-${b}s`} repeatCount="indefinite" path={CNI_PATH} />
              </circle>
            ))}
            {CSI_PATHS.map((d, i) => (
              <rect key={d} x={-3} y={-3} width={6} height={6} rx={1} fill="var(--color-f3)">
                <animateMotion dur="1.6s" begin={`-${i * 0.8}s`} repeatCount="indefinite" path={d} />
              </rect>
            ))}
          </>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-faint">
        <Legend color="var(--color-accent)" label="Talos API (talosctl → apid)" />
        <Legend color="var(--color-f4)" label="etcd quorum" />
        <Legend color="var(--color-f2)" label="pod traffic over the CNI" />
        <Legend color="var(--color-f3)" label="block I/O via CSI" />
      </div>
    </div>
  );
}

function Chip({ x, y, w, label, color, small }: { x: number; y: number; w: number; label: string; color: string; small?: boolean }) {
  const h = small ? 16 : 18;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={`color-mix(in srgb, ${color} 14%, var(--color-panel-2))`} stroke={color} strokeOpacity={0.55} />
      <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" className="fill-ink font-mono text-[9.5px]">
        {label}
      </text>
    </g>
  );
}

function Cylinder({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <path d={`M${x - 16},${y} L${x - 16},${y + 18} A16,5 0 0 0 ${x + 16},${y + 18} L${x + 16},${y}`} fill="color-mix(in srgb, var(--color-f3) 18%, var(--color-panel-2))" stroke="var(--color-f3)" strokeOpacity={0.7} />
      <ellipse cx={x} cy={y} rx={16} ry={5} fill="color-mix(in srgb, var(--color-f3) 30%, var(--color-panel-2))" stroke="var(--color-f3)" strokeOpacity={0.7} />
    </g>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
