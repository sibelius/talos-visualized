"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Pill, Segmented } from "../ui";

type Kind = "live" | "install" | "reboot";
const CHANGES: { id: string; path: string; label: string; kind: Kind; note: string }[] = [
  { id: "labels", path: "machine.nodeLabels", label: "node labels", kind: "live", note: "Talos updates the Node object." },
  { id: "kubelet", path: "machine.kubelet.extraArgs", label: "kubelet flags", kind: "live", note: "machined restarts the kubelet service." },
  { id: "net", path: "machine.network.nameservers", label: "DNS servers / addresses", kind: "live", note: "Network controllers reconcile in place." },
  { id: "sysctl", path: "machine.sysctls", label: "sysctls", kind: "live", note: "Written to /proc/sys immediately." },
  { id: "apiserver", path: "cluster.apiServer.extraArgs", label: "kube-apiserver flags", kind: "live", note: "Static pod manifest is regenerated; the apiserver restarts." },
  { id: "install", path: "machine.install.image", label: "installer image", kind: "install", note: "Accepted live, but only used by the next install/upgrade." },
  { id: "files", path: "machine.files", label: "extra files on disk", kind: "reboot", note: "Written during boot, so they need a reboot." },
  { id: "env", path: "machine.env", label: "environment vars", kind: "reboot", note: "Process environment of system services is set at boot." },
];

type Mode = "auto" | "no-reboot" | "reboot" | "staged" | "try";
const MODE_HELP: Record<Mode, string> = {
  auto: "Default. Apply live if every change supports it, otherwise apply and reboot.",
  "no-reboot": "Apply live or fail. Safe for automation that must never reboot a node.",
  reboot: "Always reboot after writing the config.",
  staged: "Write the config to STATE now; it takes effect on the next reboot (e.g. a maintenance window or upgrade).",
  try: "Apply live temporarily; if you don't confirm it within --timeout (default 1m), Talos rolls back. Great for risky network changes.",
};

type Phase = "idle" | "applying" | "rebooting" | "trying" | "done" | "rejected" | "rolledback";

export function ApplyModes() {
  const [sel, setSel] = useState<string[]>(["labels", "net"]);
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stateCfg, setStateCfg] = useState<"v1" | "v2">("v1");
  const [runCfg, setRunCfg] = useState<"v1" | "v2">("v1");
  const [countdown, setCountdown] = useState(0);

  const changes = CHANGES.filter((c) => sel.includes(c.id));
  const needsReboot = changes.some((c) => c.kind === "reboot");

  function reset() {
    setPhase("idle");
    setStateCfg("v1");
    setRunCfg("v1");
    setCountdown(0);
  }

  function apply() {
    reset();
    if (!changes.length) return;
    if ((mode === "no-reboot" || mode === "try") && needsReboot) {
      setPhase("rejected");
      return;
    }
    setPhase("applying");
    setTimeout(() => {
      if (mode === "staged") {
        setStateCfg("v2");
        setPhase("done");
      } else if (mode === "try") {
        setRunCfg("v2");
        setPhase("trying");
        setCountdown(60);
      } else if (mode === "reboot" || (mode === "auto" && needsReboot)) {
        setStateCfg("v2");
        setPhase("rebooting");
        setTimeout(() => {
          setRunCfg("v2");
          setPhase("done");
        }, 2200);
      } else {
        setStateCfg("v2");
        setRunCfg("v2");
        setPhase("done");
      }
    }, 700);
  }

  // try-mode countdown (60s simulated at 10x speed)
  useEffect(() => {
    if (phase !== "trying") return;
    if (countdown <= 0) {
      setRunCfg("v1");
      setPhase("rolledback");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 100);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  const verdict = (() => {
    switch (phase) {
      case "idle":
        return { tone: "muted", text: "Pick changes and a mode, then apply." };
      case "applying":
        return { tone: "muted", text: "machined validates the config and computes the diff…" };
      case "rejected":
        return { tone: "bad", text: `Rejected: ${changes.filter((c) => c.kind === "reboot").map((c) => c.path).join(", ")} can't be applied without a reboot. Nothing changed.` };
      case "rebooting":
        return { tone: "warn", text: "Config persisted to STATE. The node reboots and comes back running v2 (plan a drain if workloads care)." };
      case "trying":
        return { tone: "warn", text: `Running v2 on probation: rollback in ${Math.ceil(countdown)}s unless confirmed.` };
      case "rolledback":
        return { tone: "bad", text: "Timeout expired: Talos reverted to the previous config. Your node is reachable again even if v2 broke networking." };
      case "done":
        if (mode === "staged") return { tone: "ok", text: "Staged: STATE has v2, the node still runs v1 until its next reboot." };
        return { tone: "ok", text: needsReboot || mode === "reboot" ? "Applied with a reboot." : "Applied live, no reboot. Workloads kept running." };
    }
  })();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">what changed in the config</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {CHANGES.map((c) => (
              <li key={c.id}>
                <label className={clsx("flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5", sel.includes(c.id) ? "border-faint bg-panel-2" : "border-line")} title={c.note}>
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--color-accent)]"
                    checked={sel.includes(c.id)}
                    onChange={(e) => {
                      reset();
                      setSel((xs) => (e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id)));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink">{c.label}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint">{c.path}</span>
                  </span>
                  <span
                    className={clsx(
                      "ml-auto shrink-0 rounded px-1 font-mono text-[9.5px]",
                      c.kind === "live" && "bg-ok/15 text-ok",
                      c.kind === "install" && "bg-info/15 text-info",
                      c.kind === "reboot" && "bg-warn/15 text-warn",
                    )}
                  >
                    {c.kind}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="text-[11px] tracking-wide text-faint uppercase">--mode</div>
          <Segmented<Mode>
            value={mode}
            options={["auto", "no-reboot", "reboot", "staged", "try"]}
            onChange={(m) => {
              setMode(m);
              reset();
            }}
          />
          <p className="text-[13px] leading-relaxed text-muted">{MODE_HELP[mode]}</p>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px]">
            <span className="text-accent">$</span>
            <span className="min-w-0 flex-1 break-all">
              talosctl -n 10.0.0.21 apply-config -f worker.yaml --mode {mode}
              {mode === "try" ? " --timeout 1m" : ""}
            </span>
            <Button variant="primary" onClick={apply} disabled={phase === "applying" || phase === "rebooting" || phase === "trying"}>
              Apply
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Slot title="STATE partition (persisted)" v={stateCfg} />
        <Slot title="running config (in machined)" v={runCfg} rebooting={phase === "rebooting"} />
        <div
          aria-live="polite"
          className={clsx(
            "flex flex-col justify-center rounded-lg border p-3 text-sm",
            verdict.tone === "ok" && "border-ok/40 text-ok",
            verdict.tone === "bad" && "border-bad/40 text-bad",
            verdict.tone === "warn" && "border-warn/40 text-warn",
            verdict.tone === "muted" && "border-line text-muted",
          )}
        >
          {verdict.text}
          {phase === "trying" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
                <div className="h-full bg-warn transition-all duration-100" style={{ width: `${(countdown / 60) * 100}%` }} />
              </div>
              <Button
                onClick={() => {
                  setStateCfg("v2");
                  setPhase("done");
                  setMode("no-reboot");
                }}
              >
                Confirm (re-apply, no-reboot)
              </Button>
            </div>
          )}
        </div>
      </div>
      <p className="text-[12px] text-faint">
        Change categories follow the Talos docs on which fields support live apply; when in doubt, <code className="font-mono">--dry-run</code> prints
        the diff and whether a reboot would be needed. Try-mode timer runs at 10× speed here.
      </p>
    </div>
  );
}

function Slot({ title, v, rebooting }: { title: string; v: "v1" | "v2"; rebooting?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/50 p-3">
      <div className="text-[11px] tracking-wide text-faint uppercase">{title}</div>
      <div className="mt-2 flex items-center gap-2">
        <span
          key={v}
          className={clsx(
            "rounded-md px-2 py-0.5 font-mono text-sm animate-rise",
            v === "v2" ? "bg-accent/20 text-accent" : "bg-panel text-muted",
          )}
        >
          config {v}
        </span>
        {rebooting && <Pill color="var(--color-warn)">⟳ rebooting</Pill>}
      </div>
    </div>
  );
}
