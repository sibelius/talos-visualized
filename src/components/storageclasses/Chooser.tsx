"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Panel, Pill, Toggle } from "../ui";
import { SCS, type ScInfo } from "./data";

type Req = {
  survive: boolean;
  rwx: boolean;
  snapshots: boolean;
  s3: boolean;
  perf: boolean;
  simple: boolean;
  proxmox: boolean;
  pveCeph: boolean;
  nas: boolean;
};

const LABELS: { key: keyof Req; label: string; group: "need" | "prefer" | "have" }[] = [
  { key: "survive", label: "Data must survive losing a node", group: "need" },
  { key: "rwx", label: "ReadWriteMany (shared filesystem)", group: "need" },
  { key: "snapshots", label: "CSI VolumeSnapshots", group: "need" },
  { key: "s3", label: "S3-compatible object storage too", group: "need" },
  { key: "perf", label: "Latency-sensitive (databases)", group: "prefer" },
  { key: "simple", label: "Small team — minimal ops", group: "prefer" },
  { key: "proxmox", label: "Talos runs as VMs on Proxmox", group: "have" },
  { key: "pveCeph", label: "Proxmox cluster already runs Ceph", group: "have" },
  { key: "nas", label: "A NAS (TrueNAS / NFS server)", group: "have" },
];

type Result = { sc: ScInfo; score: number; reasons: string[]; blocked: string[] };

function evaluate(sc: ScInfo, r: Req): Result {
  const reasons: string[] = [];
  const blocked: string[] = [];
  let score = 10 + sc.perf + (6 - sc.ops);

  if (sc.needs === "proxmox" && !r.proxmox) blocked.push("only makes sense when nodes are Proxmox VMs");
  if (sc.needs === "pveCeph" && !r.pveCeph) blocked.push("needs an existing Ceph cluster (e.g. Proxmox's)");
  if (sc.needs === "nas" && !r.nas) blocked.push("needs a NAS to point at");

  // Proxmox CSI only survives node loss when the backing storage is shared
  const survives = sc.id === "proxmox-csi" ? (r.pveCeph ? "yes" : "no") : sc.survivesNodeLoss;
  if (r.survive) {
    if (survives === "no") blocked.push(sc.id === "proxmox-csi" ? "on local Proxmox storage the volume is pinned to one host" : "single copy on one node");
    else if (survives === "partial") reasons.push("survives node loss, but the NAS is a single point of failure");
    else reasons.push(sc.id === "proxmox-csi" ? "on shared Ceph-backed Proxmox storage the disk can move hosts" : `replicated: ${sc.replication}`);
  }
  if (r.rwx) {
    if (sc.rwx === "no") blocked.push("no ReadWriteMany");
    else reasons.push(`RWX: ${sc.rwxNote}`);
  }
  if (r.snapshots) {
    if (sc.snapshots === "no") blocked.push("no CSI snapshots");
    else if (sc.snapshots === "partial") {
      reasons.push(`snapshots: ${sc.snapNote}`);
      score -= 2;
    } else reasons.push(`snapshots: ${sc.snapNote}`);
  }
  if (r.s3) {
    if (!sc.objectS3) blocked.push("no object storage (pair it with MinIO/Garage/SeaweedFS, or pick Rook)");
    else reasons.push("RGW gives you S3 from the same cluster");
  }
  if (r.perf) {
    score += sc.perf * 3;
    if (sc.perf >= 4) reasons.push(sc.perfNote);
    if (sc.perf <= 2) reasons.push(`⚠ ${sc.perfNote}`);
  }
  if (r.simple) {
    score += (6 - sc.ops) * 3;
    if (sc.ops <= 2) reasons.push(`low ops: ${sc.opsNote}`);
    if (sc.ops >= 4) reasons.push(`⚠ ops-heavy: ${sc.opsNote}`);
  }
  if (sc.id === "proxmox-csi" && r.proxmox) {
    score += 6;
    reasons.push("reuses the hypervisor's storage — no storage system inside k8s");
  }
  if (sc.id === "ceph-external" && r.pveCeph) {
    score += 7;
    reasons.push("Ceph is already run (and upgraded) by Proxmox");
  }
  if (sc.id === "rook-ceph" && r.pveCeph) {
    score -= 4;
    reasons.push("⚠ a second Ceph inside VMs on top of Proxmox's Ceph is double replication");
  }
  if ((sc.id === "nfs" || sc.id === "democratic-csi") && r.nas) score += 4;
  if (reasons.length === 0) reasons.push(sc.what);
  return { sc, score, reasons, blocked };
}

export function Chooser() {
  const [req, setReq] = useState<Req>({
    survive: true,
    rwx: false,
    snapshots: false,
    s3: false,
    perf: false,
    simple: true,
    proxmox: true,
    pveCeph: false,
    nas: false,
  });
  const results = useMemo(() => {
    const all = SCS.map((sc) => evaluate(sc, req));
    const ok = all.filter((x) => x.blocked.length === 0).sort((a, b) => b.score - a.score);
    const no = all.filter((x) => x.blocked.length > 0);
    return { ok, no };
  }, [req]);
  const top = results.ok[0]?.score ?? 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Panel title="Your requirements">
        {(["need", "prefer", "have"] as const).map((g) => (
          <div key={g} className="mb-4 last:mb-0">
            <div className="mb-2 font-mono text-[11px] tracking-wide text-faint uppercase">
              {g === "need" ? "must have" : g === "prefer" ? "prefer" : "you already have"}
            </div>
            <div className="flex flex-col gap-2.5">
              {LABELS.filter((l) => l.group === g).map((l) => (
                <Toggle key={l.key} checked={req[l.key]} onChange={(v) => setReq((r) => ({ ...r, [l.key]: v }))} label={l.label} />
              ))}
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="Ranked fit" right={<span className="font-mono text-[11px] text-faint">{results.ok.length} candidates</span>}>
        {results.ok.length === 0 && (
          <p className="py-6 text-center text-sm text-faint">Nothing satisfies every hard requirement — relax one, or combine two StorageClasses.</p>
        )}
        <ol className="space-y-2">
          {results.ok.map((r, i) => (
            <li
              key={r.sc.id}
              className={clsx("rounded-lg border p-3 transition-all", i === 0 ? "border-transparent" : "border-line bg-panel-2/40")}
              style={i === 0 ? { borderColor: r.sc.color, background: `color-mix(in srgb, ${r.sc.color} 8%, transparent)` } : undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-faint">#{i + 1}</span>
                <span className="font-medium text-ink">{r.sc.name}</span>
                <Pill color={r.sc.color}>{r.sc.provisioner}</Pill>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(8, (r.score / top) * 100)}%`, background: r.sc.color }}
                />
              </div>
              <ul className="mt-2 space-y-0.5 text-[13px] text-muted">
                {r.reasons.slice(0, 4).map((x, k) => (
                  <li key={k} className={x.startsWith("⚠") ? "text-warn" : undefined}>
                    {x.startsWith("⚠") ? x : `· ${x}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {results.no.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">Ruled out ({results.no.length})</summary>
            <ul className="mt-2 space-y-1">
              {results.no.map((r) => (
                <li key={r.sc.id} className="text-[13px] text-faint">
                  <span className="text-muted line-through">{r.sc.short}</span> — {r.blocked.join("; ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
    </div>
  );
}
