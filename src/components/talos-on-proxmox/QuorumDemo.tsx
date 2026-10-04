"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, Callout, Panel, Segmented, Stat } from "@/components/ui";
import { HostBox } from "@/components/proxmox/parts";

type Host = "pve1" | "pve2" | "pve3";
const HOSTS: Host[] = ["pve1", "pve2", "pve3"];

const PRESETS: Record<string, Host[]> = {
  "all on pve1": ["pve1", "pve1", "pve1"],
  "2 + 1": ["pve1", "pve1", "pve2"],
  "spread 1/1/1": ["pve1", "pve2", "pve3"],
};

export function QuorumDemo() {
  const [place, setPlace] = useState<Host[]>(PRESETS["all on pve1"]);
  const [down, setDown] = useState<Set<Host>>(new Set());

  const alive = place.filter((h) => !down.has(h)).length;
  const quorum = alive >= 2; // floor(3/2)+1
  const preset = Object.entries(PRESETS).find(([, v]) => v.join() === place.join())?.[0] ?? "custom";

  // worst single-host failure for this placement
  const worst = Math.min(...HOSTS.map((h) => place.filter((p) => p !== h).length));

  const toggle = (h: Host) =>
    setDown((d) => {
      const n = new Set(d);
      if (n.has(h)) n.delete(h);
      else n.add(h);
      return n;
    });

  return (
    <Panel
      title="Spread your control planes across Proxmox hosts"
      right={
        <Segmented
          value={preset}
          onChange={(v) => {
            if (PRESETS[v]) setPlace(PRESETS[v]);
          }}
          options={[...Object.keys(PRESETS), ...(preset === "custom" ? ["custom"] : [])]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {HOSTS.map((h) => (
              <HostBox
                key={h}
                name={h}
                down={down.has(h)}
                className="sm:min-h-32"
                sub={
                  <button
                    type="button"
                    onClick={() => toggle(h)}
                    className={clsx("font-mono text-[10px]", down.has(h) ? "text-ok" : "text-faint hover:text-bad")}
                    aria-label={`${down.has(h) ? "Power on" : "Power off"} ${h}`}
                  >
                    ⏻ {down.has(h) ? "on" : "off"}
                  </button>
                }
              >
                {place.map((p, k) =>
                  p === h ? (
                    <div
                      key={k}
                      className={clsx(
                        "flex animate-rise items-center justify-between rounded-md border px-2 py-1 font-mono text-[11px] transition",
                        down.has(h) ? "border-bad/50 bg-bad/10 text-bad line-through" : "border-warn/50 bg-warn/10 text-ink",
                      )}
                    >
                      cp-{k + 1}
                      <span className="text-[9px] text-warn">etcd</span>
                    </div>
                  ) : null,
                )}
              </HostBox>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Move a control plane:</span>
            {place.map((p, k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="font-mono">cp-{k + 1}</span>
                <select
                  aria-label={`Proxmox host for cp-${k + 1}`}
                  value={p}
                  onChange={(e) => setPlace((pl) => pl.map((x, j) => (j === k ? (e.target.value as Host) : x)))}
                  className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[11px] text-ink"
                >
                  {HOSTS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </span>
            ))}
            <Button variant="ghost" onClick={() => setDown(new Set())}>
              power everything on
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="etcd members up" value={`${alive}/3`} tone={alive === 3 ? "good" : quorum ? "warn" : "bad"} />
            <Stat label="quorum (need 2)" value={quorum ? "yes" : "LOST"} tone={quorum ? "good" : "bad"} />
            <Stat label="kube-apiserver" value={quorum ? "serving" : "unavailable"} tone={quorum ? "good" : "bad"} />
            <Stat label="worst 1-host loss" value={`${worst}/3 left`} tone={worst >= 2 ? "good" : "bad"} />
          </div>
          {quorum ? (
            <Callout tone={alive === 3 ? "ok" : "warn"} title={alive === 3 ? "Healthy" : "Degraded but writable"}>
              {alive === 3
                ? "Power off a host to see what this placement survives."
                : "A majority of etcd members still agree, so writes continue. The VIP moves to a surviving control plane and kubectl keeps working."}
            </Callout>
          ) : (
            <Callout tone="bad" title="Quorum lost">
              etcd needs ⌊n/2⌋+1 = 2 of 3 members. Without that it refuses writes, so the API server can&apos;t change anything: no scheduling, no
              updates, no leader elections. Three control-plane VMs on one Proxmox host give you one failure domain, not three.
            </Callout>
          )}
          <p className="text-[13px] leading-relaxed text-muted">
            The same arithmetic applies to Proxmox itself: corosync needs a majority of hosts, so a 3-host Proxmox cluster survives one host
            failure. In Terraform, pin each control plane with <code className="font-mono text-ink">node_name</code>. If you use Proxmox HA, configure
            its placement (HA groups, or affinity rules in newer releases) so a failover doesn&apos;t stack two control planes on one host.
          </p>
        </div>
      </div>
    </Panel>
  );
}
