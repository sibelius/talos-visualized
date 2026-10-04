"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Mono, Pill, Segmented, Toggle } from "../ui";

const EXTENSIONS: { id: string; why: string; group: string }[] = [
  { id: "siderolabs/qemu-guest-agent", why: "Proxmox/QEMU sees the VM's IPs and can request clean shutdowns.", group: "virtualization" },
  { id: "siderolabs/iscsi-tools", why: "iscsid + iscsiadm: needed by Longhorn and iSCSI-based CSI drivers (OpenEBS, democratic-csi).", group: "storage" },
  { id: "siderolabs/util-linux-tools", why: "Extra util-linux binaries (e.g. fstrim) that Longhorn expects on the host.", group: "storage" },
  { id: "siderolabs/drbd", why: "DRBD kernel module for LINSTOR / Piraeus replicated volumes.", group: "storage" },
  { id: "siderolabs/zfs", why: "ZFS kernel module and tools, e.g. for OpenEBS ZFS-LocalPV.", group: "storage" },
  { id: "siderolabs/intel-ucode", why: "CPU microcode updates for Intel hosts (bare metal).", group: "hardware" },
  { id: "siderolabs/amd-ucode", why: "CPU microcode updates for AMD hosts (bare metal).", group: "hardware" },
  { id: "siderolabs/nonfree-kmod-nvidia-production", why: "NVIDIA kernel driver; pair with the container toolkit for GPU pods.", group: "hardware" },
  { id: "siderolabs/nvidia-container-toolkit-production", why: "Lets containerd hand NVIDIA GPUs to containers.", group: "hardware" },
  { id: "siderolabs/tailscale", why: "Tailscale as a system service, for out-of-band node access.", group: "network" },
];

const KARGS = [
  { id: "net.ifnames=0", why: "Classic eth0 names instead of predictable ones" },
  { id: "console=ttyS0", why: "Kernel console on the serial port (VM serial terminal)" },
  { id: "talos.dashboard.disabled=1", why: "No dashboard on the local console" },
];

type Platform = "metal" | "nocloud";

/** Deterministic 64-hex-char digest (FNV-1a, 8 lanes). Looks like a schematic ID; it is not the real algorithm. */
function fakeId(s: string) {
  let out = "";
  for (let lane = 0; lane < 8; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

export function SchematicBuilder() {
  const [exts, setExts] = useState<string[]>(["siderolabs/qemu-guest-agent", "siderolabs/iscsi-tools", "siderolabs/util-linux-tools"]);
  const [kargs, setKargs] = useState<string[]>([]);
  const [platform, setPlatform] = useState<Platform>("nocloud");
  const [secure, setSecure] = useState(false);
  const ver = "v1.11.3";

  const yaml = useMemo(() => {
    const lines = ["customization:"];
    if (kargs.length) lines.push("  extraKernelArgs:", ...kargs.map((k) => `    - ${k}`));
    if (exts.length) lines.push("  systemExtensions:", "    officialExtensions:", ...[...exts].sort().map((e) => `      - ${e}`));
    if (!kargs.length && !exts.length) lines[0] = "customization: {}";
    return lines.join("\n");
  }, [exts, kargs]);

  const id = useMemo(() => fakeId(yaml), [yaml]);

  const sb = secure ? "-secureboot" : "";
  const installer = `factory.talos.dev/${platform}-installer${sb}/${id}:${ver}`;
  const iso = `https://factory.talos.dev/image/${id}/${ver}/${platform}-amd64${sb}.iso`;
  const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">system extensions</div>
          <ul className="space-y-1">
            {EXTENSIONS.map((e) => (
              <li key={e.id}>
                <label className={clsx("flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5", exts.includes(e.id) ? "border-faint bg-panel-2" : "border-line")}>
                  <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={exts.includes(e.id)} onChange={() => setExts((xs) => toggle(xs, e.id))} />
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] text-ink">{e.id}</span>
                    <span className="block text-[11.5px] leading-snug text-faint">{e.why}</span>
                  </span>
                  <span className="ml-auto hidden shrink-0 text-[10px] text-faint sm:inline">{e.group}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">extra kernel args</div>
          <div className="flex flex-wrap gap-1.5">
            {KARGS.map((k) => (
              <button
                key={k.id}
                type="button"
                title={k.why}
                aria-pressed={kargs.includes(k.id)}
                onClick={() => setKargs((xs) => toggle(xs, k.id))}
                className={clsx("rounded-md border px-2 py-0.5 font-mono text-[11.5px]", kargs.includes(k.id) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}
              >
                {k.id}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Segmented<Platform> value={platform} options={["metal", "nocloud"]} onChange={setPlatform} />
          <Toggle checked={secure} onChange={setSecure} label="Secure Boot" />
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-wide text-faint uppercase">
            <span>schematic.yaml</span>
            <span className="normal-case">POST /schematics</span>
          </div>
          <Mono className="min-h-28">{yaml}</Mono>
        </div>
        <div className="flex justify-center text-faint" aria-hidden>
          ↓ content hash
        </div>
        <div key={id} className="rounded-lg border border-accent/40 bg-accent/5 p-3 animate-flash">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] tracking-wide text-faint uppercase">schematic ID</span>
            <Pill color="var(--color-warn)">illustrative, not a real ID</Pill>
          </div>
          <code className="block font-mono text-[11.5px] break-all text-accent">{id}</code>
        </div>
        <div className="space-y-2 text-[12px]">
          <Url label="installer image (install & upgrade)" value={installer} />
          <Url label="boot ISO" value={iso} />
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          Same schematic, same ID: the factory derives the ID from the schematic content, so it&apos;s safe to commit the
          ID and rebuild any image from it. Changing an extension changes the ID, and moving a node to it means a{" "}
          <code className="font-mono">talosctl upgrade</code> (even at the same Talos version).
        </p>
      </div>
    </div>
  );
}

function Url({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[10.5px] tracking-wide text-faint uppercase">{label}</div>
      <code className="block font-mono text-[11.5px] break-all text-ink">{value}</code>
    </div>
  );
}
