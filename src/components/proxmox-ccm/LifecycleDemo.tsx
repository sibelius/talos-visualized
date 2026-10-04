"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Panel } from "@/components/ui";
import { EventLog, HostBox, VmChip } from "@/components/proxmox/parts";

type VmState = "running" | "stopped" | "deleted" | "unknown";
type W = { name: string; vmid: number; host: string; vm: VmState; ready: boolean; exists: boolean; shutdownTaint: boolean; busy: boolean };
type Ev = { who: string; msg: string; tone?: "ok" | "bad" | "warn" | "info" };

const INITIAL: W[] = [
  { name: "worker-1", vmid: 111, host: "pve1", vm: "running", ready: true, exists: true, shutdownTaint: false, busy: false },
  { name: "worker-2", vmid: 112, host: "pve2", vm: "running", ready: true, exists: true, shutdownTaint: false, busy: false },
  { name: "worker-3", vmid: 113, host: "pve3", vm: "running", ready: true, exists: true, shutdownTaint: false, busy: false },
];

const STEP = 1100;

export function LifecycleDemo() {
  const [ws, setWs] = useState<W[]>(INITIAL);
  const [hostDown, setHostDown] = useState<string | null>(null);
  const [log, setLog] = useState<Ev[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const patch = (name: string, p: Partial<W>) => setWs((all) => all.map((w) => (w.name === name ? { ...w, ...p } : w)));
  const push = (e: Ev) => setLog((l) => [...l.slice(-30), e]);

  const run = (seq: [() => void, Ev?][]) => {
    seq.forEach(([fn, ev], i) => {
      timers.current.push(
        setTimeout(() => {
          fn();
          if (ev) push(ev);
        }, i * STEP),
      );
    });
  };

  const shutdown = (w: W) =>
    run([
      [() => patch(w.name, { vm: "stopped", busy: true }), { who: "pve", msg: `qm shutdown ${w.vmid} → status stopped` }],
      [() => {}, { who: "kubelet", msg: `${w.name} stops posting NodeStatus` }],
      [() => patch(w.name, { ready: false }), { who: "kcm", msg: `node-lifecycle: ${w.name} Ready=Unknown (grace period expired)`, tone: "warn" }],
      [() => {}, { who: "ccm", msg: `InstanceExists(${w.name}) → VM ${w.vmid} found → true` }],
      [
        () => patch(w.name, { shutdownTaint: true, busy: false }),
        { who: "ccm", msg: `InstanceShutdown → status=stopped → taint node.cloudprovider.kubernetes.io/shutdown:NoSchedule`, tone: "warn" },
      ],
    ]);

  const start = (w: W) =>
    run([
      [() => patch(w.name, { vm: "running", busy: true }), { who: "pve", msg: `qm start ${w.vmid}` }],
      [() => patch(w.name, { ready: true }), { who: "kubelet", msg: `${w.name} Ready=True` , tone: "ok"}],
      [() => patch(w.name, { shutdownTaint: false, busy: false }), { who: "ccm", msg: "node is Ready again → shutdown taint removed", tone: "ok" }],
    ]);

  const destroy = (w: W) =>
    run([
      [() => patch(w.name, { vm: "deleted", busy: true }), { who: "pve", msg: `qm destroy ${w.vmid} (e.g. terraform scale-down)`, tone: "bad" }],
      [() => patch(w.name, { ready: false }), { who: "kcm", msg: `node-lifecycle: ${w.name} Ready=Unknown`, tone: "warn" }],
      [() => {}, { who: "ccm", msg: `InstanceExists(proxmox://cluster-1/${w.vmid}) → not found → false`, tone: "bad" }],
      [() => patch(w.name, { exists: false, busy: false }), { who: "ccm", msg: `DELETE node ${w.name} → pods get rescheduled, no manual kubectl delete`, tone: "ok" }],
    ]);

  const killHost = (h: string) => {
    setHostDown(h);
    const victims = ws.filter((w) => w.host === h && w.exists);
    run([
      [() => victims.forEach((w) => patch(w.name, { vm: "unknown", busy: true })), { who: "pve", msg: `${h} unreachable — its VMs report status "unknown"`, tone: "bad" }],
      [() => victims.forEach((w) => patch(w.name, { ready: false })), { who: "kcm", msg: `${victims.map((v) => v.name).join(", ") || "no nodes"} Ready=Unknown`, tone: "warn" }],
      [
        () => victims.forEach((w) => patch(w.name, { busy: false })),
        { who: "ccm", msg: "Proxmox node inaccessible → InstanceExists returns true: can't prove it's gone, so the Node is kept", tone: "info" },
      ],
    ]);
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setWs(INITIAL);
    setHostDown(null);
    setLog([]);
  };

  const anyBusy = ws.some((w) => w.busy);

  return (
    <Panel title="cloud-node-lifecycle: what happens when the VM goes away" right={<Button variant="ghost" onClick={reset}>Reset</Button>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {["pve1", "pve2", "pve3"].map((h) => (
              <HostBox
                key={h}
                name={h}
                down={hostDown === h}
                sub={
                  <button
                    type="button"
                    disabled={!!hostDown || anyBusy}
                    onClick={() => killHost(h)}
                    className="font-mono text-[10px] text-faint hover:text-bad disabled:opacity-40"
                    aria-label={`Power off Proxmox host ${h}`}
                  >
                    ⏻ host
                  </button>
                }
              >
                {ws
                  .filter((w) => w.host === h)
                  .map((w) => (
                    <VmChip
                      key={w.name}
                      name={w.name}
                      vmid={w.vmid}
                      tone={w.vm === "deleted" ? "ghost" : w.vm === "stopped" ? "warn" : w.vm === "unknown" ? "bad" : "ok"}
                      right={<span className="text-[10px] text-faint">{w.vm}</span>}
                    >
                      {w.vm !== "deleted" && w.vm !== "unknown" && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {w.vm === "running" ? (
                            <>
                              <MiniBtn disabled={w.busy} onClick={() => shutdown(w)}>shutdown</MiniBtn>
                              <MiniBtn danger disabled={w.busy} onClick={() => destroy(w)}>destroy</MiniBtn>
                            </>
                          ) : (
                            <>
                              <MiniBtn disabled={w.busy} onClick={() => start(w)}>start</MiniBtn>
                              <MiniBtn danger disabled={w.busy} onClick={() => destroy(w)}>destroy</MiniBtn>
                            </>
                          )}
                        </div>
                      )}
                    </VmChip>
                  ))}
              </HostBox>
            ))}
          </div>
          <EventLog items={log} />
        </div>

        <div className="min-w-0">
          <div className="overflow-x-auto rounded-lg border border-line bg-bg">
            <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-faint">kubectl get nodes</div>
            <table className="w-full font-mono text-[11.5px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="px-3 py-1.5 font-normal">NAME</th>
                  <th className="px-3 py-1.5 font-normal">STATUS</th>
                  <th className="px-3 py-1.5 font-normal">TAINTS</th>
                </tr>
              </thead>
              <tbody>
                {ws.map((w) => (
                  <tr key={w.name} className={clsx("transition-all duration-500", !w.exists && "opacity-30")}>
                    <td className={clsx("px-3 py-1.5", w.exists ? "text-ink" : "text-bad line-through")}>{w.name}</td>
                    <td className={clsx("px-3 py-1.5", !w.exists ? "text-bad" : w.ready ? "text-ok" : "text-warn")}>
                      {!w.exists ? "deleted" : w.ready ? "Ready" : "NotReady"}
                    </td>
                    <td className="px-3 py-1.5 text-[10.5px] text-muted">
                      {w.exists && w.shutdownTaint && <span className="text-warn">node.cloudprovider.kubernetes.io/shutdown</span>}
                      {w.exists && !w.ready && <div className="text-faint">node.kubernetes.io/unreachable</div>}
                      {w.exists && w.ready && !w.shutdownTaint && <span className="text-faint">&lt;none&gt;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted">
            <li>
              <span className="text-warn">Shutdown</span> keeps the Node and adds a <code className="font-mono text-ink">shutdown</code> taint — the VM
              may come back, and its identity (providerID) is still valid.
            </li>
            <li>
              <span className="text-bad">Destroy</span> makes <code className="font-mono text-ink">InstanceExists</code> false, so the Node object is
              deleted. This is the reason the project exists: scaling down with Terraform no longer leaves ghost nodes.
            </li>
            <li>
              <span className="text-info">Host down</span> is ambiguous. The CCM treats an unreachable Proxmox node as &quot;can&apos;t tell&quot; and keeps
              the Node rather than deleting it on a network blip.
            </li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function MiniBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded border px-1.5 py-0.5 font-mono text-[10px] transition disabled:opacity-40",
        danger ? "border-bad/50 text-bad hover:bg-bad/10" : "border-line text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
