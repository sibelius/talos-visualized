"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Toggle } from "../ui";

type NodeId = "cp1" | "cp2" | "cp3" | "w1" | "w2";
const NODES: { id: NodeId; name: string; ip: string; cp: boolean }[] = [
  { id: "cp1", name: "cp-1", ip: "10.0.0.10", cp: true },
  { id: "cp2", name: "cp-2", ip: "10.0.0.11", cp: true },
  { id: "cp3", name: "cp-3", ip: "10.0.0.12", cp: true },
  { id: "w1", name: "worker-1", ip: "10.0.0.21", cp: false },
  { id: "w2", name: "worker-2", ip: "10.0.0.22", cp: false },
];

const STEPS: { title: string; cmd?: string; text: string }[] = [
  { title: "Boot the ISO", text: "Every machine boots the Talos ISO/PXE image into maintenance mode: no config, nothing installed, apid listening on :50000 waiting for one." },
  {
    title: "Push configs (insecure)",
    cmd: "talosctl apply-config --insecure -n 10.0.0.10 -f controlplane.yaml   # …and the rest",
    text: "No PKI exists on the node yet, so this first apply is unauthenticated (--insecure). Do it on a trusted network.",
  },
  { title: "Install & reboot", text: "Each node writes Talos to machine.install.disk (EFI, A/B boot, META, STATE with the config, EPHEMERAL) and reboots from disk." },
  {
    title: "Waiting for bootstrap",
    text: "Control planes start the etcd service, but it waits: nobody has said which node creates the cluster. kubelets start and wait for an API server.",
  },
  {
    title: "Bootstrap ONE node",
    cmd: "talosctl bootstrap -n 10.0.0.10 -e 10.0.0.10",
    text: "cp-1 initialises a brand-new, single-member etcd cluster. This is a one-time act for the life of the cluster.",
  },
  { title: "Control plane static pods", text: "machined renders static pod manifests; the kubelet on cp-1 starts kube-apiserver, kube-controller-manager and kube-scheduler against the local etcd." },
  { title: "Other CPs join etcd", text: "cp-2 and cp-3 find the existing cluster and join as members (added as learners, then promoted). Each starts its own control-plane pods. Quorum is now 2 of 3." },
  { title: "Nodes register", text: "Every kubelet registers its Node. Talos applies bootstrap manifests (CoreDNS, and flannel + kube-proxy unless disabled). Without a CNI, nodes stay NotReady." },
  { title: "CNI → Ready", cmd: "helm install cilium …   # if cni.name: none", text: "Once the CNI programs pod networking on each node, the kubelets report Ready." },
  { title: "Get a kubeconfig", cmd: "talosctl kubeconfig -n 10.0.0.10   # merges into ~/.kube/config", text: "Talos mints an admin kubeconfig from the cluster CA. kubectl get nodes: 5 Ready." },
];

type Cell = { label: string; tone: "off" | "wait" | "run" | "ok" | "bad" };

function cellsFor(n: (typeof NODES)[number], s: number, split: boolean): Cell[] {
  const disk: Cell = s < 2 ? { label: "ISO · maintenance", tone: "wait" } : s === 2 ? { label: "installing…", tone: "run" } : { label: "installed", tone: "ok" };
  const cfg: Cell = s < 1 ? { label: "no config", tone: "off" } : { label: n.cp ? "controlplane.yaml" : "worker.yaml", tone: "ok" };
  let etcd: Cell = { label: "—", tone: "off" };
  if (n.cp) {
    if (s < 3) etcd = { label: "—", tone: "off" };
    else if (s === 3) etcd = { label: "waiting", tone: "wait" };
    else if (n.id === "cp1") etcd = { label: s === 4 ? "new cluster (1)" : "leader", tone: "ok" };
    else if (split && n.id === "cp2") etcd = { label: "2nd cluster!", tone: "bad" };
    else if (s < 6) etcd = { label: "waiting", tone: "wait" };
    else etcd = { label: "member", tone: "ok" };
  }
  let cp: Cell = { label: "—", tone: "off" };
  if (n.cp) {
    const up = n.id === "cp1" ? s >= 5 : s >= 6;
    cp = up ? { label: "apiserver · cm · sched", tone: split && n.id === "cp2" ? "bad" : "ok" } : s >= 3 ? { label: "pending", tone: "wait" } : { label: "—", tone: "off" };
  }
  let kubelet: Cell = { label: "—", tone: "off" };
  if (s >= 3)
    kubelet =
      s >= 7
        ? { label: "registered", tone: "ok" }
        : s >= 5
          ? { label: "registering…", tone: "run" }
          : n.cp
            ? { label: "running (static pods)", tone: "run" }
            : { label: "waiting for API", tone: "wait" };
  let node: Cell = { label: "—", tone: "off" };
  if (s >= 7) node = s >= 8 ? { label: "Ready", tone: "ok" } : { label: "NotReady (no CNI)", tone: "wait" };
  return [disk, cfg, etcd, cp, kubelet, node];
}
const ROWS = ["disk", "config", "etcd", "control plane", "kubelet", "Node"];

export function BringUp() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [split, setSplit] = useState(false);
  const cur = STEPS[step];

  useEffect(() => {
    if (!playing) return;
    if (step >= STEPS.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1800);
    return () => clearTimeout(t);
  }, [playing, step]);

  const showSplit = split && step >= 4;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => {
            if (step >= STEPS.length - 1) setStep(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "❚❚ Pause" : step >= STEPS.length - 1 ? "↺ Replay" : "▶ Play"}
        </Button>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          ←
        </Button>
        <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>
          →
        </Button>
        <div className="ml-auto">
          <Toggle checked={split} onChange={setSplit} label={<span>mistake: also run bootstrap on cp-2</span>} />
        </div>
      </div>

      {/* step rail */}
      <ol className="flex gap-1" aria-label="bring-up steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setStep(i)}
              title={s.title}
              aria-current={i === step}
              className={clsx("h-1.5 w-full rounded-full transition", i < step ? "bg-accent/60" : i === step ? "bg-accent" : "bg-panel-2")}
            />
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-line bg-panel-2/50 p-3" aria-live="polite">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs text-accent">
            {String(step + 1).padStart(2, "0")}/{STEPS.length}
          </span>
          <span className="font-medium">{cur.title}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{cur.text}</p>
        {cur.cmd && <code className="mt-2 block font-mono text-[12px] break-all text-ink">$ {cur.cmd}</code>}
        {showSplit && (
          <p className="mt-2 rounded-md border border-bad/40 bg-bad/10 px-2 py-1.5 text-[13px] text-bad">
            Bootstrapping cp-2 as well made it create its <em>own</em> etcd cluster. You now have two clusters with two sets of
            Kubernetes state, and cp-2 can never join cp-1&apos;s. Recovery means resetting cp-2. That&apos;s why bootstrap runs exactly once.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[6.5rem_repeat(5,minmax(0,1fr))] gap-1.5 text-[11.5px]">
          <div />
          {NODES.map((n) => (
            <div key={n.id} className="rounded-md bg-panel-2 px-2 py-1.5">
              <div className="font-medium text-ink">{n.name}</div>
              <div className="font-mono text-[10px] text-faint">
                {n.ip} · {n.cp ? "cp" : "worker"}
              </div>
            </div>
          ))}
          {ROWS.map((row, r) => (
            <Row key={row} label={row} cells={NODES.map((n) => cellsFor(n, step, showSplit)[r])} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: Cell[] }) {
  return (
    <>
      <div className="flex items-center text-[10.5px] tracking-wide text-faint uppercase">{label}</div>
      {cells.map((c, i) => (
        <div
          key={i + c.label}
          className={clsx(
            "flex min-h-8 items-center rounded-md border px-2 py-1 font-mono text-[10.5px] leading-tight animate-rise",
            c.tone === "off" && "border-transparent bg-panel/40 text-faint",
            c.tone === "wait" && "border-warn/30 bg-warn/5 text-warn",
            c.tone === "run" && "border-info/40 bg-info/10 text-info animate-pulse-soft",
            c.tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
            c.tone === "bad" && "border-bad/50 bg-bad/15 text-bad",
          )}
        >
          {c.label}
        </div>
      ))}
    </>
  );
}
