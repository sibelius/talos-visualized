"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Mono, Panel, Segmented, Stat } from "@/components/ui";
import { HostBox, VmChip } from "@/components/proxmox/parts";

type Mode = "none" | "hostname" | "zone";

const NODES = [
  { name: "worker-1a", host: "pve1" },
  { name: "worker-1b", host: "pve1" },
  { name: "worker-2a", host: "pve2" },
  { name: "worker-2b", host: "pve2" },
  { name: "worker-3a", host: "pve3" },
  { name: "worker-3b", host: "pve3" },
];

// Plausible placements for 3 replicas under each policy.
const PLACEMENT: Record<Mode, string[]> = {
  none: ["worker-1a", "worker-1a", "worker-1b"],
  hostname: ["worker-1a", "worker-1b", "worker-2a"],
  zone: ["worker-1a", "worker-2b", "worker-3a"],
};

const SNIPPET: Record<Mode, string> = {
  none: "# no topologySpreadConstraints\n# (only soft scheduler defaults: packing is allowed)",
  hostname: `topologySpreadConstraints:
- maxSkew: 1
  topologyKey: kubernetes.io/hostname
  whenUnsatisfiable: DoNotSchedule
  labelSelector: { matchLabels: { app: pg } }`,
  zone: `topologySpreadConstraints:
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone   # set by Proxmox CCM
  whenUnsatisfiable: DoNotSchedule
  labelSelector: { matchLabels: { app: pg } }`,
};

export function SpreadDemo() {
  const [mode, setMode] = useState<Mode>("none");
  const [down, setDown] = useState<string | null>(null);
  const placed = PLACEMENT[mode];
  const alive = placed.filter((n) => NODES.find((x) => x.name === n)!.host !== down).length;

  return (
    <Panel
      title="Why the zone label matters: spread replicas across Proxmox hosts"
      right={
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setDown(null);
          }}
          options={[
            { value: "none", label: "no spread" },
            { value: "hostname", label: "spread by node" },
            { value: "zone", label: "spread by zone" },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {["pve1", "pve2", "pve3"].map((h) => (
              <HostBox
                key={h}
                name={h}
                down={down === h}
                sub={<span className="font-mono text-[10px] text-faint">zone={h}</span>}
              >
                {NODES.filter((n) => n.host === h).map((n) => {
                  const count = placed.filter((p) => p === n.name).length;
                  return (
                    <VmChip key={n.name} name={n.name} tone={down === h ? "bad" : count ? "active" : "default"}>
                      <div className="mt-1 flex min-h-4 gap-1">
                        {Array.from({ length: count }).map((_, i) => (
                          <span
                            key={i}
                            className={clsx(
                              "rounded px-1 font-mono text-[9px] transition",
                              down === h ? "bg-bad/20 text-bad line-through" : "bg-accent/20 text-accent",
                            )}
                          >
                            pg
                          </span>
                        ))}
                      </div>
                    </VmChip>
                  );
                })}
              </HostBox>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {["pve1", "pve2", "pve3"].map((h) => (
              <Button key={h} variant={down === h ? "danger" : "default"} onClick={() => setDown(down === h ? null : h)}>
                {down === h ? `power on ${h}` : `power off ${h}`}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="replicas up" value={`${alive}/3`} tone={alive === 3 ? "good" : alive >= 2 ? "warn" : "bad"} />
            <Stat label="survives any 1 host?" value={mode === "zone" ? "yes" : "no"} tone={mode === "zone" ? "good" : "bad"} />
          </div>
          <Mono>{SNIPPET[mode]}</Mono>
          <p className="text-[13px] leading-relaxed text-muted">
            {mode === "none" && "Nothing stops all replicas landing on VMs that share one physical box."}
            {mode === "hostname" && "Spreading across Kubernetes nodes isn't enough: worker-1a and worker-1b are two VMs on the same Proxmox host, so one power failure still takes out two of three replicas."}
            {mode === "zone" && "Because the CCM sets topology.kubernetes.io/zone to the Proxmox host name, the scheduler can finally see the physical failure domain."}
          </p>
        </div>
      </div>
    </Panel>
  );
}
