"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Segmented, Stat } from "../ui";

const SIZES = ["1", "2", "3", "4", "5"] as const;

export function QuorumSim() {
  const [size, setSize] = useState<(typeof SIZES)[number]>("3");
  const n = Number(size);
  const [down, setDown] = useState<boolean[]>(Array(5).fill(false));
  const alive = down.slice(0, n).filter((d) => !d).length;
  const quorum = Math.floor(n / 2) + 1;
  const tolerate = n - quorum;
  const ok = alive >= quorum;

  const r = 92;
  const cx = 130;
  const cy = 118;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">etcd members</span>
          <Segmented
            value={size}
            options={SIZES}
            onChange={(s) => {
              setSize(s);
              setDown(Array(5).fill(false));
            }}
          />
          <Button variant="ghost" onClick={() => setDown(Array(5).fill(false))}>
            Heal all
          </Button>
        </div>
        <svg viewBox="0 0 260 236" className="mx-auto w-full max-w-[340px]" role="img" aria-label={`${alive} of ${n} etcd members healthy, quorum ${quorum}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-line)" strokeDasharray="4 6" />
          {Array.from({ length: n }).map((_, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = n === 1 ? cx : cx + r * Math.cos(a);
            const y = n === 1 ? cy : cy + r * Math.sin(a);
            const isDown = down[i];
            const leader = !isDown && ok && down.slice(0, n).findIndex((d) => !d) === i;
            return (
              <g key={i}>
                {Array.from({ length: n }).map((__, j) => {
                  if (j <= i || n === 1) return null;
                  const b = (j / n) * Math.PI * 2 - Math.PI / 2;
                  const live = !isDown && !down[j];
                  return (
                    <line
                      key={j}
                      x1={x}
                      y1={y}
                      x2={cx + r * Math.cos(b)}
                      y2={cy + r * Math.sin(b)}
                      stroke={live ? (ok ? "var(--color-ok)" : "var(--color-warn)") : "var(--color-line)"}
                      strokeOpacity={live ? 0.6 : 0.4}
                      strokeDasharray="5 5"
                      className={live ? "animate-dash" : undefined}
                    />
                  );
                })}
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`member ${i + 1} ${isDown ? "down, click to recover" : "up, click to fail"}`}
                  onClick={() => setDown((d) => d.map((v, k) => (k === i ? !v : v)))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setDown((d) => d.map((v, k) => (k === i ? !v : v)));
                  }}
                  className="cursor-pointer outline-none"
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={22}
                    fill={isDown ? "color-mix(in srgb, var(--color-bad) 18%, var(--color-panel))" : "var(--color-panel-2)"}
                    stroke={isDown ? "var(--color-bad)" : leader ? "var(--color-accent)" : "var(--color-ok)"}
                    strokeWidth={leader ? 2.5 : 1.5}
                    style={{ transition: "all 250ms" }}
                  />
                  <text x={x} y={y + 1} textAnchor="middle" className="fill-ink font-mono text-[11px]">
                    cp-{i + 1}
                  </text>
                  <text x={x} y={y + 13} textAnchor="middle" className={clsx("text-[8.5px]", isDown ? "fill-bad" : leader ? "fill-accent" : "fill-faint")}>
                    {isDown ? "down" : leader ? "leader" : "follower"}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
        <p className="text-center text-[12px] text-faint">Click a member to fail or recover it.</p>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="quorum needed" value={`${quorum} of ${n}`} />
          <Stat label="failures tolerated" value={tolerate} tone={tolerate === 0 ? "bad" : "good"} />
          <Stat label="healthy" value={`${alive}/${n}`} tone={ok ? "good" : "bad"} />
          <Stat label="writes (and K8s API)" value={ok ? "available" : "blocked"} tone={ok ? "good" : "bad"} />
        </div>
        <div
          className={clsx(
            "rounded-lg border p-3 text-sm",
            ok ? "border-ok/30 text-muted" : "border-bad/40 bg-bad/5 text-bad",
          )}
          aria-live="polite"
        >
          {ok
            ? alive === quorum && n > 1
              ? "Exactly at quorum: one more failure and the cluster stops accepting writes."
              : "A majority can elect a leader and commit writes. The Kubernetes API keeps working."
            : `Only ${alive} of ${n} members: no majority, no leader, no writes. kube-apiserver can't persist anything; running pods keep running but nothing can change.`}
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wide text-faint uppercase">
              <th className="py-1 font-medium">members</th>
              <th className="py-1 font-medium">quorum</th>
              <th className="py-1 font-medium">tolerates</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {[1, 2, 3, 4, 5].map((m) => (
              <tr key={m} className={clsx("border-t border-line", m === n && "text-accent", m % 2 === 0 && m !== n && "text-faint")}>
                <td className="py-1">{m}</td>
                <td className="py-1">{Math.floor(m / 2) + 1}</td>
                <td className="py-1">
                  {m - (Math.floor(m / 2) + 1)}
                  {m % 2 === 0 && <span className="ml-2 font-sans text-[11px] text-warn">same as {m - 1}, more to fail</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
