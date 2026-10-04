"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Panel } from "@/components/ui";
import { DiskIcon, HostBox } from "@/components/proxmox/parts";

export type BuildStep = { title: string; tool: string; appears: string; why: ReactNode };

const HOSTS = ["pve1", "pve2", "pve3"] as const;

function Badge({ on, children, tone = "accent", title }: { on: boolean; children: ReactNode; tone?: "accent" | "ok" | "info" | "blue" | "warn"; title?: string }) {
  if (!on) return null;
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex animate-rise items-center rounded px-1 font-mono text-[9px] leading-4",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "info" && "bg-info/15 text-info",
        tone === "blue" && "bg-accent-2/20 text-[#7fa6ff]",
        tone === "warn" && "bg-warn/15 text-warn",
      )}
    >
      {children}
    </span>
  );
}

function VmBox({ name, vmid, cp, step, host }: { name: string; vmid: number; cp: boolean; step: number; host: string }) {
  const exists = step >= 2;
  const ready = step >= 5;
  return (
    <div
      className={clsx(
        "rounded-md border px-1.5 py-1 transition-all duration-500",
        !exists && "border-dashed border-line opacity-30",
        exists && !ready && "border-warn/50 bg-warn/5",
        ready && "border-ok/50 bg-ok/5",
      )}
    >
      <div className="flex items-center justify-between gap-1 font-mono text-[10.5px]">
        <span className="truncate text-ink">
          <span className="text-faint">{vmid} </span>
          {name}
        </span>
        {exists && <span className={clsx("text-[9px]", ready ? "text-ok" : "text-warn")}>{step < 4 ? "maint." : ready ? "Ready" : "NotReady"}</span>}
      </div>
      <div className="mt-0.5 flex min-h-4 flex-wrap gap-0.5">
        <Badge on={step >= 2} tone="info" title="QEMU guest agent extension">qga</Badge>
        <Badge on={step >= 4}>talos</Badge>
        <Badge on={cp && step >= 4} tone="warn">etcd</Badge>
        <Badge on={step >= 5} tone="blue">cilium</Badge>
        <Badge on={cp && step >= 6} tone="ok">ccm</Badge>
        <Badge on={step >= 6} tone="ok" title="topology.kubernetes.io/zone">zone={host}</Badge>
        <Badge on={!cp && step >= 7} tone="info">csi-node</Badge>
        <Badge on={cp && step >= 7} tone="info">csi-ctrl</Badge>
        <Badge on={!cp && host === "pve2" && step >= 8} tone="accent">pvc→scsi1</Badge>
      </div>
    </div>
  );
}

export function BuildStepper({ steps, snippets }: { steps: BuildStep[]; snippets: ReactNode[] }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false));
  const step = i + 1; // 1-based for the diagram
  const cur = steps[i];

  const go = (n: number) => setI(Math.max(0, Math.min(steps.length - 1, n)));
  const complete = () => {
    setDone((d) => d.map((v, k) => (k === i ? true : v)));
    go(i + 1);
  };

  return (
    <Panel
      title="The reference build"
      right={<span className="font-mono text-[11px] text-faint">{done.filter(Boolean).length}/{steps.length} checked</span>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <ol className="space-y-1">
          {steps.map((s, k) => (
            <li key={k} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`Mark step ${k + 1} done`}
                checked={done[k]}
                onChange={(e) => setDone((d) => d.map((v, j) => (j === k ? e.target.checked : v)))}
                className="mt-2 size-3.5 shrink-0 accent-[var(--color-ok)]"
              />
              <button
                type="button"
                onClick={() => go(k)}
                className={clsx(
                  "flex-1 rounded-md px-2 py-1.5 text-left text-[13px] transition",
                  k === i ? "bg-accent/10 text-ink" : done[k] ? "text-muted line-through decoration-faint hover:bg-panel-2" : "text-muted hover:bg-panel-2",
                )}
              >
                <span className="mr-1.5 font-mono text-[11px] text-accent">{k + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-w-0 space-y-3">
          {/* diagram */}
          <div className="rounded-xl border border-line bg-bg/40 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Chip on={step >= 1} label="Image Factory" sub="schematic: qemu-guest-agent" active={step === 1} />
              <Arrow on={step >= 2} />
              <Chip on={step >= 2} label="Terraform" sub="bpg/proxmox + siderolabs/talos" active={step === 2} />
              <Arrow on={step >= 3} />
              <Chip on={step >= 3} label="talosctl" sub="patches · VIP 10.0.0.10" active={step === 3 || step === 4} />
              <div className="ml-auto flex items-center gap-1.5">
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 font-mono text-[10px] transition",
                    step >= 4 ? "border-ok/60 text-ok" : "border-line text-faint",
                  )}
                >
                  VIP 10.0.0.10:6443 {step >= 4 ? "●" : "○"}
                </span>
              </div>
            </div>
            <div className="mb-1 font-mono text-[10px] text-faint">Proxmox cluster cluster-1 (region)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {HOSTS.map((h, k) => (
                <HostBox key={h} name={h} active={step === 2 || step === 6} sub={<span className="font-mono text-[10px] text-faint">zone</span>}>
                  <VmBox name={`cp-${k + 1}`} vmid={101 + k} cp step={step} host={h} />
                  <VmBox name={`worker-${k + 1}`} vmid={111 + k} cp={false} step={step} host={h} />
                  <div className="flex items-center gap-1 rounded border border-dashed border-line px-1 py-0.5 font-mono text-[9px] text-faint">
                    <DiskIcon className="size-3" /> local-lvm
                    {h === "pve2" && step >= 8 && <span className="animate-rise text-accent">· vm-9999-pvc-…</span>}
                  </div>
                </HostBox>
              ))}
            </div>
          </div>

          {/* explanation */}
          <div key={i} className="animate-rise space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-accent">step {i + 1}</span>
              <h3 className="text-base font-semibold">{cur.title}</h3>
              <span className="rounded border border-line px-1.5 font-mono text-[10px] text-faint">{cur.tool}</span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              <span className="text-ink">Appears: </span>
              {cur.appears}
            </p>
            <div className="text-[13px] leading-relaxed text-muted">{cur.why}</div>
            {snippets[i]}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={i === 0} onClick={() => go(i - 1)}>
                ← Previous
              </Button>
              <Button variant="primary" onClick={complete}>
                {i === steps.length - 1 ? "Mark done" : "Done, next step →"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Chip({ on, label, sub, active }: { on: boolean; label: string; sub: string; active: boolean }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-2 py-1 transition-all duration-500",
        !on && "border-dashed border-line opacity-30",
        on && !active && "border-line bg-panel-2/60",
        active && "border-accent bg-accent/10",
      )}
    >
      <div className="font-mono text-[11px] text-ink">{label}</div>
      <div className="font-mono text-[9px] text-faint">{sub}</div>
    </div>
  );
}

function Arrow({ on }: { on: boolean }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden className="hidden shrink-0 sm:block">
      <path d="M1 5 H19 M15 1 L20 5 L15 9" fill="none" stroke={on ? "var(--color-accent)" : "var(--color-line)"} strokeWidth="1.5" />
    </svg>
  );
}
