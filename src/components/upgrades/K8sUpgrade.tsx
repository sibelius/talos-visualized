"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button } from "../ui";

const FROM = "1.33.5";
const TO = "1.34.1";
const CPS = ["cp-1", "cp-2", "cp-3"];
const WS = ["worker-1", "worker-2"];

type Ph = { title: string; text: string; apply: (s: S) => S };
type S = { api: number; cm: number; sched: number; proxy: boolean; kubelets: number; manifests: boolean };
const S0: S = { api: 0, cm: 0, sched: 0, proxy: false, kubelets: 0, manifests: false };

const PHASES: Ph[] = [
  { title: "Pre-flight", text: `Discovers nodes, checks ${FROM} → ${TO} is a supported step (one minor at a time), and that deprecated APIs in use won't vanish.`, apply: (s) => s },
  { title: "Pre-pull images", text: "Pulls the new control-plane and kubelet images on every node so restarts are quick.", apply: (s) => s },
  ...CPS.map((cp, i) => ({
    title: `kube-apiserver on ${cp}`,
    text: "Updates the static pod config through the Talos API; waits for the new pod to be ready before moving on.",
    apply: (s: S) => ({ ...s, api: i + 1 }),
  })),
  { title: "controller-manager & scheduler", text: "Same, node by node. Leader election means only one instance is active at a time anyway.", apply: (s) => ({ ...s, cm: 3, sched: 3 }) },
  { title: "kube-proxy", text: "Updates the kube-proxy DaemonSet (skipped when proxy is disabled for Cilium).", apply: (s) => ({ ...s, proxy: true }) },
  ...[...CPS, ...WS].map((n, i) => ({
    title: `kubelet on ${n}`,
    text: "Patches machine.kubelet.image in that node's config; machined restarts the kubelet. No reboot, no drain: pods keep running.",
    apply: (s: S) => ({ ...s, kubelets: i + 1 }),
  })),
  { title: "Bootstrap manifests", text: "Re-applies Talos's bootstrap manifests (CoreDNS, RBAC, …) for the new version, showing a diff first.", apply: (s) => ({ ...s, manifests: true }) },
];

export function K8sUpgrade() {
  const [i, setI] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const s = PHASES.slice(0, i + 1).reduce((acc, p) => p.apply(acc), S0);

  useEffect(() => {
    if (!playing) return;
    if (i >= PHASES.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((x) => x + 1), 900);
    return () => clearTimeout(t);
  }, [playing, i]);

  const v = (done: boolean) => (done ? TO : FROM);
  const all = [...CPS, ...WS];
  const cur = i >= 0 ? PHASES[i] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => {
            if (i >= PHASES.length - 1) setI(-1);
            setPlaying(true);
          }}
          disabled={playing}
        >
          {i >= PHASES.length - 1 ? "↺ Replay" : "▶ upgrade-k8s"}
        </Button>
        <code className="font-mono text-[12px] break-all text-muted">
          <span className="text-accent">$ </span>talosctl -n 10.0.0.10 upgrade-k8s --to {TO}
        </code>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wide text-faint uppercase">
              <th className="py-1 font-medium">node</th>
              <th className="py-1 font-medium">apiserver</th>
              <th className="py-1 font-medium">ctrl-mgr / sched</th>
              <th className="py-1 font-medium">kube-proxy</th>
              <th className="py-1 font-medium">kubelet</th>
              <th className="py-1 font-medium">OS</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {all.map((n, k) => {
              const cp = k < 3;
              return (
                <tr key={n} className="border-t border-line">
                  <td className="py-1.5 font-sans text-ink">{n}</td>
                  <td className="py-1.5">{cp ? <V v={v(s.api > k)} /> : <span className="text-faint">—</span>}</td>
                  <td className="py-1.5">{cp ? <V v={v(s.cm > k)} /> : <span className="text-faint">—</span>}</td>
                  <td className="py-1.5">
                    <V v={v(s.proxy)} />
                  </td>
                  <td className="py-1.5">
                    <V v={v(s.kubelets > k)} />
                  </td>
                  <td className="py-1.5 text-faint">Talos v1.11.3</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-line bg-panel-2/50 p-3 text-sm" aria-live="polite">
        {cur ? (
          <>
            <span className="font-mono text-xs text-accent">
              {i + 1}/{PHASES.length}{" "}
            </span>
            <span className="font-medium text-ink">{cur.title}. </span>
            <span className="text-muted">{cur.text}</span>
          </>
        ) : (
          <span className="text-muted">
            Kubernetes is upgraded separately from Talos: the OS column never changes here. Control-plane components go first so
            kubelets are never newer than the API server.
          </span>
        )}
      </div>
    </div>
  );
}

function V({ v }: { v: string }) {
  return <span className={clsx("rounded px-1 transition-colors", v === TO ? "bg-ok/15 text-ok" : "text-muted")}>{v}</span>;
}
