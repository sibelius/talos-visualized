"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Pill, Toggle } from "../ui";

type Slot = { ver: string; state: "active" | "fallback" | "writing" | "next" | "broken" | "idle" };
type Frame = { title: string; text: string; a: Slot; b: Slot; node: string; tone: "ok" | "run" | "warn" | "bad"; k8s: string };

const OLD = "v1.11.2";
const NEW = "v1.11.3";

function frames(fail: boolean): Frame[] {
  const base: Frame[] = [
    { title: "Running", text: `Node boots ${OLD} from slot A. Slot B holds whatever was there before.`, a: { ver: OLD, state: "active" }, b: { ver: "v1.11.1", state: "idle" }, node: "Ready", tone: "ok", k8s: "schedulable" },
    {
      title: "Upgrade requested",
      text: "talosctl upgrade sends the image ref. On a control plane, Talos first checks etcd is healthy so this node's reboot won't break quorum.",
      a: { ver: OLD, state: "active" },
      b: { ver: "v1.11.1", state: "idle" },
      node: "checking",
      tone: "run",
      k8s: "schedulable",
    },
    { title: "Cordon & drain", text: "The node cordons itself and evicts pods (respecting PodDisruptionBudgets), then stops services and unmounts filesystems.", a: { ver: OLD, state: "active" }, b: { ver: "v1.11.1", state: "idle" }, node: "draining", tone: "warn", k8s: "cordoned" },
    { title: "Write inactive slot", text: `The installer image is pulled and verified; its kernel + initramfs (${NEW}) are written to slot B. Slot A is not touched.`, a: { ver: OLD, state: "fallback" }, b: { ver: NEW, state: "writing" }, node: "installing", tone: "run", k8s: "cordoned" },
    { title: "Flip & reboot", text: "The bootloader's default entry now points at B; A stays as the fallback entry. The node reboots.", a: { ver: OLD, state: "fallback" }, b: { ver: NEW, state: "next" }, node: "rebooting", tone: "warn", k8s: "NotReady" },
  ];
  if (!fail)
    return [
      ...base,
      { title: "Up on the new version", text: `${NEW} boots from B, STATE and EPHEMERAL are reused as-is (same config, same etcd data, cached images). The node rejoins and uncordons.`, a: { ver: OLD, state: "fallback" }, b: { ver: NEW, state: "active" }, node: "Ready", tone: "ok", k8s: "schedulable" },
    ];
  return [
    ...base,
    { title: "New image fails to boot", text: `${NEW} panics or never comes up (bad kernel arg, missing driver…).`, a: { ver: OLD, state: "fallback" }, b: { ver: NEW, state: "broken" }, node: "boot failed", tone: "bad", k8s: "NotReady" },
    { title: "Fallback to slot A", text: `The bootloader falls back to the previous entry and ${OLD} boots again with the untouched STATE/EPHEMERAL. You can also switch back on purpose with talosctl rollback.`, a: { ver: OLD, state: "active" }, b: { ver: NEW, state: "broken" }, node: "Ready", tone: "ok", k8s: "uncordon when ready" },
  ];
}

export function ABUpgrade() {
  const [fail, setFail] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fs = frames(fail);
  const f = fs[Math.min(i, fs.length - 1)];

  useEffect(() => {
    if (!playing) return;
    if (i >= fs.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((x) => x + 1), 1700);
    return () => clearTimeout(t);
  }, [playing, i, fs.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => {
            if (i >= fs.length - 1) setI(0);
            setPlaying(true);
          }}
          disabled={playing}
        >
          {i >= fs.length - 1 ? "↺ Replay" : "▶ Upgrade"}
        </Button>
        <Button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={playing || i === 0}>
          ←
        </Button>
        <Button onClick={() => setI((x) => Math.min(fs.length - 1, x + 1))} disabled={playing || i >= fs.length - 1}>
          →
        </Button>
        <div className="ml-auto">
          <Toggle
            checked={fail}
            onChange={(v) => {
              setFail(v);
              setI(0);
              setPlaying(false);
            }}
            label="new image fails to boot"
          />
        </div>
      </div>
      <code className="block rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px] break-all text-ink">
        <span className="text-accent">$ </span>talosctl -n 10.0.0.21 upgrade --image factory.talos.dev/installer/&lt;schematic-id&gt;:{NEW}
      </code>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="text-[11px] tracking-wide text-faint uppercase">boot slots</div>
          <div className="grid grid-cols-2 gap-2">
            <SlotBox name="A" s={f.a} />
            <SlotBox name="B" s={f.b} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-accent/30 bg-panel-2/50 px-2.5 py-1.5">
              <span className="font-mono text-accent">STATE</span> <span className="text-faint">config · kept</span>
            </div>
            <div className="rounded-lg border border-f2/30 bg-panel-2/50 px-2.5 py-1.5">
              <span className="font-mono text-f2">EPHEMERAL</span> <span className="text-faint">/var · kept</span>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] tracking-wide text-faint uppercase">node</div>
          <div
            className={clsx(
              "flex items-center justify-between rounded-lg border px-3 py-2",
              f.tone === "ok" && "border-ok/40",
              f.tone === "run" && "border-info/40",
              f.tone === "warn" && "border-warn/40",
              f.tone === "bad" && "border-bad/50 bg-bad/10",
            )}
          >
            <span className="font-medium">worker-1</span>
            <span
              className={clsx(
                "font-mono text-xs",
                f.tone === "ok" && "text-ok",
                f.tone === "run" && "text-info animate-pulse-soft",
                f.tone === "warn" && "text-warn animate-pulse-soft",
                f.tone === "bad" && "text-bad",
              )}
            >
              {f.node}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            kubernetes: <Pill>{f.k8s}</Pill>
          </div>
        </div>
      </div>

      <ol className="flex gap-1">
        {fs.map((x, k) => (
          <li key={x.title} className="flex-1">
            <button
              type="button"
              aria-label={x.title}
              onClick={() => setI(k)}
              className={clsx("h-1.5 w-full rounded-full", k < i ? "bg-accent/60" : k === i ? (x.tone === "bad" ? "bg-bad" : "bg-accent") : "bg-panel-2")}
            />
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-line bg-panel-2/50 p-3 text-sm" aria-live="polite">
        <span className="font-medium text-ink">{f.title}. </span>
        <span className="text-muted">{f.text}</span>
      </div>
    </div>
  );
}

function SlotBox({ name, s }: { name: string; s: Slot }) {
  const label = { active: "booted", fallback: "fallback", writing: "writing…", next: "next boot", broken: "failed", idle: "previous" }[s.state];
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl border p-3 transition-all duration-500",
        s.state === "active" && "border-ok/60 bg-ok/10",
        s.state === "fallback" && "border-line bg-panel-2/60",
        s.state === "writing" && "border-info/60 bg-info/10",
        s.state === "next" && "border-accent/60 bg-accent/10",
        s.state === "broken" && "border-bad/60 bg-bad/10",
        s.state === "idle" && "border-line bg-panel/40 opacity-60",
      )}
    >
      {s.state === "writing" && <div className="absolute inset-y-0 left-0 w-full origin-left animate-pulse-soft bg-info/10" />}
      <div className="relative flex items-baseline justify-between">
        <span className="font-mono text-xs text-faint">slot {name}</span>
        <span className="text-[11px] text-muted">{label}</span>
      </div>
      <div className="relative mt-1 font-mono text-lg text-ink">{s.ver}</div>
      <div className="relative text-[10.5px] text-faint">kernel + initramfs</div>
    </div>
  );
}
