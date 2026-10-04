"use client";

import { useState } from "react";
import clsx from "clsx";
import { Pill, Segmented } from "../ui";

type Part = {
  id: string;
  size: string;
  grow: number;
  color: string;
  mount: string;
  holds: string;
  why: string;
};

const PARTS: Part[] = [
  {
    id: "EFI",
    size: "~100 MiB+",
    grow: 1.2,
    color: "var(--color-f1)",
    mount: "/boot/EFI (UEFI)",
    holds: "Bootloader. With systemd-boot (UEFI installs on recent Talos) the A/B Unified Kernel Images live here too.",
    why: "Firmware needs a FAT partition it can read. Everything after this is Talos-owned.",
  },
  {
    id: "BIOS",
    size: "1 MiB",
    grow: 0.4,
    color: "var(--color-faint)",
    mount: "—",
    holds: "GRUB core image for legacy BIOS boot.",
    why: "Only used on BIOS / GRUB installs.",
  },
  {
    id: "BOOT",
    size: "~1 GiB",
    grow: 2,
    color: "var(--color-f4)",
    mount: "/boot (GRUB installs)",
    holds: "Two kernel + initramfs pairs: slot A and slot B.",
    why: "A/B slots are what make upgrades atomic: the new image goes to the inactive slot, the old one stays bootable for rollback.",
  },
  {
    id: "META",
    size: "1 MiB",
    grow: 0.5,
    color: "var(--color-f3)",
    mount: "not mounted",
    holds: "Tiny raw key/value store (e.g. upgrade state, early network config for maintenance mode).",
    why: "Data that must exist before any filesystem is mounted.",
  },
  {
    id: "STATE",
    size: "~100 MiB",
    grow: 1.2,
    color: "var(--color-accent)",
    mount: "/system/state",
    holds: "The machine configuration (config.yaml) and node identity. Can be encrypted (TPM / KMS / static key).",
    why: "The only thing that defines the node. Survives upgrades; wiping it returns the node to maintenance mode.",
  },
  {
    id: "EPHEMERAL",
    size: "rest of disk",
    grow: 7,
    color: "var(--color-f2)",
    mount: "/var",
    holds: "containerd images & snapshots, kubelet dir, pod emptyDirs, logs, and etcd data on control planes (/var/lib/etcd).",
    why: "All the mutable data lives here, and only here. Size and placement are configurable (VolumeConfig).",
  },
];

type Op = "none" | "upgrade" | "reset-ephemeral" | "reset";
const OPS: Record<Op, { label: string; cmd: string; effect: Record<string, "write" | "wipe" | "keep">; note: string }> = {
  none: { label: "running", cmd: "", effect: {}, note: "Click a partition to see what it holds." },
  upgrade: {
    label: "upgrade",
    cmd: "talosctl upgrade --image …",
    effect: { EFI: "write", BOOT: "write", META: "write" },
    note: "Writes the new kernel/initramfs into the inactive boot slot and flips the default. STATE and EPHEMERAL (etcd, images) are untouched.",
  },
  "reset-ephemeral": {
    label: "reset EPHEMERAL",
    cmd: "talosctl reset --system-labels-to-wipe EPHEMERAL --reboot",
    effect: { EPHEMERAL: "wipe" },
    note: "Drops images, pod data and etcd data but keeps the config: the node reboots and rejoins with the same identity. (On a control plane, leave etcd first — graceful reset does this.)",
  },
  reset: {
    label: "full reset",
    cmd: "talosctl reset --graceful --reboot",
    effect: { STATE: "wipe", EPHEMERAL: "wipe" },
    note: "Cordons/drains, leaves etcd (control plane), then wipes STATE + EPHEMERAL. The node boots into maintenance mode, waiting for a new config.",
  },
};

export function DiskLayout() {
  const [sel, setSel] = useState("STATE");
  const [op, setOp] = useState<Op>("none");
  const part = PARTS.find((p) => p.id === sel)!;
  const o = OPS[op];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Op> value={op} options={(Object.keys(OPS) as Op[]).map((k) => ({ value: k, label: OPS[k].label }))} onChange={setOp} />
        {o.cmd && <code className="font-mono text-[12px] text-accent">$ {o.cmd}</code>}
      </div>

      {/* RAM */}
      <div className="rounded-xl border border-dashed border-line p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] tracking-wide text-faint uppercase">
          <span>in memory</span>
          <span className="normal-case">loaded from the initramfs on every boot</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MemBox title="/ (rootfs)" sub="SquashFS · read-only" body="machined, apid, trustd, containerd, runc… roughly a dozen binaries. The kubelet itself runs from a container image." />
          <MemBox title="/system" sub="tmpfs" body="runtime state: sockets, generated configs" />
          <MemBox title="/etc, /usr …" sub="read-only (a few files bind-mounted)" body="no package manager could write here even if it existed" />
        </div>
      </div>

      {/* disk */}
      <div>
        <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">install disk (GPT)</div>
        <div className="flex h-20 w-full overflow-hidden rounded-xl border border-line" role="listbox" aria-label="Talos partitions">
          {PARTS.map((p) => {
            const eff = o.effect[p.id];
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={sel === p.id}
                onClick={() => setSel(p.id)}
                style={{
                  flexGrow: p.grow,
                  flexBasis: 0,
                  background: eff === "wipe" ? "color-mix(in srgb, var(--color-bad) 25%, var(--color-panel))" : `color-mix(in srgb, ${p.color} ${sel === p.id ? 32 : 16}%, var(--color-panel))`,
                }}
                className={clsx(
                  "relative min-w-0 border-r border-bg px-1 text-center transition-all last:border-r-0",
                  sel === p.id && "ring-2 ring-ink/60 ring-inset",
                )}
              >
                <span className="block truncate font-mono text-[10px] font-semibold text-ink sm:text-[11px]">{p.id}</span>
                <span className="block truncate text-[9.5px] text-faint">{p.size}</span>
                {eff && (
                  <span
                    className={clsx(
                      "absolute inset-x-1 bottom-1 truncate rounded px-1 font-mono text-[9px] animate-pulse-soft",
                      eff === "wipe" ? "bg-bad/30 text-bad" : "bg-accent/25 text-accent",
                    )}
                  >
                    {eff}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel-2/50 p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold" style={{ color: part.color }}>
              {part.id}
            </span>
            <Pill>{part.mount}</Pill>
          </div>
          <p className="text-muted">{part.holds}</p>
          <p className="mt-2 text-[13px] text-faint">{part.why}</p>
        </div>
        <div className="rounded-lg border border-line bg-panel-2/50 p-3 text-sm text-muted" aria-live="polite">
          <div className="mb-1 text-[11px] tracking-wide text-faint uppercase">{op === "none" ? "tip" : "what happens"}</div>
          {o.note}
        </div>
      </div>
    </div>
  );
}

function MemBox({ title, sub, body }: { title: string; sub: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-ink">{title}</span>
        <span className="text-[10px] text-faint">{sub}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-faint">{body}</p>
    </div>
  );
}
