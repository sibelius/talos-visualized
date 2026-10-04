"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Mono, Pill, Segmented } from "../ui";

type NodeId = "cp1" | "cp2" | "w1" | "w2";
type Pt = {
  x: number;
  y: number;
  label: string;
  kind: "client" | "apid" | "machined" | "backend";
};

const NODES: Record<
  NodeId,
  { name: string; ip: string; x: number; y: number; cp: boolean }
> = {
  cp1: { name: "cp-1", ip: "10.0.0.10", x: 210, y: 16, cp: true },
  cp2: { name: "cp-2", ip: "10.0.0.11", x: 210, y: 176, cp: true },
  w1: { name: "worker-1", ip: "10.0.0.12", x: 500, y: 16, cp: false },
  w2: { name: "worker-2", ip: "10.0.0.13", x: 500, y: 176, cp: false },
};
const IDS = Object.keys(NODES) as NodeId[];

type Cmd =
  | "logs kubelet"
  | "dmesg"
  | "get members"
  | "etcd members"
  | "containers -k"
  | "apply-config";

const CMDS: Record<Cmd, { backend: string; why: string; cpOnly?: boolean }> = {
  "logs kubelet": {
    backend: "kubelet log",
    why: "machined runs kubelet as a service and keeps its log output; apid streams it back.",
  },
  dmesg: {
    backend: "kernel ring",
    why: "machined reads the kernel ring buffer — the same thing dmesg shows, minus the shell.",
  },
  "get members": {
    backend: "COSI state",
    why: "Every bit of node state is a typed resource in machined's COSI store. 'get' is a generic read of it.",
  },
  "etcd members": {
    backend: "etcd",
    why: "machined talks to the local etcd. Only control-plane nodes run etcd.",
    cpOnly: true,
  },
  "containers -k": {
    backend: "containerd",
    why: "machined asks containerd for containers in the k8s.io namespace (what the kubelet started).",
  },
  "apply-config": {
    backend: "STATE",
    why: "machined validates the new config, writes it to the STATE partition and reconciles (or reboots if needed).",
  },
};

function ptsFor(
  id: NodeId,
  backend: string,
): { apid: Pt; machined: Pt; backend: Pt } {
  const n = NODES[id];
  return {
    apid: {
      x: n.x + 52,
      y: n.y + 58,
      label: `apid on ${n.name}`,
      kind: "apid",
    },
    machined: {
      x: n.x + 168,
      y: n.y + 58,
      label: `machined on ${n.name}`,
      kind: "machined",
    },
    backend: {
      x: n.x + 168,
      y: n.y + 110,
      label: `${backend} on ${n.name}`,
      kind: "backend",
    },
  };
}

const CLIENT: Pt = { x: 70, y: 150, label: "talosctl", kind: "client" };

function sampleOutput(cmd: Cmd, targets: NodeId[]): string {
  const multi = targets.length > 1;
  const pre = (id: NodeId) => (multi ? `${NODES[id].ip}: ` : "");
  const rows: string[] = [];
  switch (cmd) {
    case "logs kubelet":
      for (const id of targets)
        rows.push(
          `${pre(id)}kubelet: I1004 09:12:01.211 kubelet_node_status.go:75] "Successfully registered node" node="${NODES[id].name}"`,
        );
      break;
    case "dmesg":
      for (const id of targets)
        rows.push(
          `${pre(id)}kern:    info: [2026-10-04T09:10:02Z]: eth0: Link is Up - 10Gbps/Full`,
        );
      break;
    case "get members":
      rows.push(
        "NODE         NAMESPACE   TYPE     ID         VERSION   HOSTNAME   MACHINE TYPE   ADDRESSES",
      );
      for (const id of targets)
        for (const m of IDS)
          rows.push(
            `${NODES[id].ip.padEnd(12)} cluster     Member   ${NODES[m].name.padEnd(10)} 2         ${NODES[m].name.padEnd(10)} ${(NODES[m].cp ? "controlplane" : "worker").padEnd(14)} ["${NODES[m].ip}"]`,
          );
      break;
    case "etcd members":
      rows.push(
        "NODE         ID                 HOSTNAME   PEER URLS                 LEARNER",
      );
      for (const id of targets)
        for (const m of ["cp1", "cp2"] as NodeId[])
          rows.push(
            `${NODES[id].ip.padEnd(12)} ${m === "cp1" ? "3b7ea1c2d4f08e19" : "9a0c55e7b21d6f43"}   ${NODES[m].name.padEnd(10)} https://${NODES[m].ip}:2380    false`,
          );
      break;
    case "containers -k":
      rows.push(
        "NODE         NAMESPACE   ID                                     IMAGE                         STATE",
      );
      for (const id of targets)
        rows.push(
          `${NODES[id].ip.padEnd(12)} k8s.io      kube-system/cilium-x7f2k:cilium-agent  quay.io/cilium/cilium:v1.18   CONTAINER_RUNNING`,
        );
      break;
    case "apply-config":
      for (const id of targets)
        rows.push(`${pre(id)}Applied configuration without a reboot`);
      break;
  }
  return rows.join("\n");
}

export function ApiPath() {
  const [cmd, setCmd] = useState<Cmd>("logs kubelet");
  const [endpoint, setEndpoint] = useState<NodeId>("cp1");
  const [targets, setTargets] = useState<NodeId[]>(["w1"]);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);

  const info = CMDS[cmd];
  const invalid = info.cpOnly ? targets.filter((t) => !NODES[t].cp) : [];

  // One path per target; all padded to the same length so dots move in lock-step.
  const paths = useMemo(() => {
    const ep = ptsFor(endpoint, info.backend);
    return targets.map((t) => {
      const p = ptsFor(t, info.backend);
      const fail = info.cpOnly && !NODES[t].cp;
      const out: Pt[] = [
        CLIENT,
        ep.apid,
        t === endpoint ? ep.apid : p.apid,
        p.machined,
        fail ? p.machined : p.backend,
      ];
      return [...out, ...out.slice(0, -1).reverse()];
    });
  }, [targets, endpoint, info]);

  const len = paths[0]?.length ?? 0;
  const done = step >= len - 1;

  useEffect(() => {
    if (!playing) return;
    if (step >= len - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [playing, step, len]);

  function reset() {
    setStep(-1);
    setPlaying(false);
  }
  function run() {
    setStep(0);
    setPlaying(true);
  }
  function toggleTarget(id: NodeId) {
    reset();
    setTargets((ts) =>
      ts.includes(id)
        ? ts.length > 1
          ? ts.filter((x) => x !== id)
          : ts
        : [...ts, id],
    );
  }

  const nodesFlag = targets.map((t) => NODES[t].ip).join(",");
  const cmdline = `talosctl -e ${NODES[endpoint].ip} -n ${nodesFlag} ${cmd}${cmd === "apply-config" ? " -f worker.yaml" : ""}`;

  const narrative = (() => {
    if (step < 0)
      return "Press run. The request is gRPC over mTLS: talosctl presents the client certificate from your talosconfig.";
    const half = Math.floor(len / 2);
    if (step === 0)
      return "talosctl dials the endpoint (-e) on :50000. Endpoints are usually control-plane IPs listed in talosconfig.";
    if (step === 1)
      return `apid on ${NODES[endpoint].name} authenticates you (mTLS, role from the cert) and reads the target list from -n.`;
    if (step === 2)
      return targets.some((t) => t !== endpoint)
        ? `apid proxies the call to apid on each target node (${targets.map((t) => NODES[t].name).join(", ")}) — fan-out happens here, not in talosctl.`
        : "Target is the endpoint itself, so no proxy hop is needed.";
    if (step === 3)
      return "apid hands the call to machined over a local unix socket. machined is PID 1 and owns everything on the node.";
    if (step === 4)
      return invalid.length
        ? `machined on ${invalid.map((t) => NODES[t].name).join(", ")} refuses: no etcd runs on a worker.`
        : info.why;
    if (step > 4 && step < len - 1)
      return "The response streams back along the same path; the endpoint apid merges replies and tags each with its node.";
    if (step >= half)
      return "Done. No SSH daemon, no shell, no sudo: one authenticated API for every node.";
    return "";
  })();

  // which edges are active (from step-1 to step)
  const activeEdges = new Set<string>();
  if (step > 0)
    for (const p of paths) activeEdges.add(edgeKey(p[step - 1], p[step]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Cmd>
          value={cmd}
          options={Object.keys(CMDS) as Cmd[]}
          onChange={(c) => {
            setCmd(c);
            reset();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-faint">-e endpoint</span>
          <Segmented<NodeId>
            value={endpoint}
            options={IDS.map((id) => ({ value: id, label: NODES[id].name }))}
            onChange={(v) => {
              setEndpoint(v);
              reset();
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-faint">-n nodes</span>
          {IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={targets.includes(id)}
              onClick={() => toggleTarget(id)}
              className={clsx(
                "rounded-md border px-2 py-0.5 font-mono text-xs transition",
                targets.includes(id)
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line text-muted hover:text-ink",
              )}
            >
              {NODES[id].ip}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12.5px]">
        <span className="text-accent">$</span>
        <span className="min-w-0 flex-1 break-all text-ink">{cmdline}</span>
        <Button variant="primary" onClick={run} disabled={playing}>
          {playing ? "Running…" : done ? "▶ Run again" : "▶ Run"}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 740 312"
          className="mx-auto w-full max-w-[880px] min-w-[560px]"
          role="img"
          aria-label={`Request path for ${cmdline}`}
        >
          <defs>
            <marker
              id="ap-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--color-accent)" />
            </marker>
          </defs>

          {/* edges for every target path */}
          {paths.map((p, i) => (
            <g key={i}>
              {p.slice(0, Math.floor(p.length / 2) + 1).map((pt, j) => {
                if (j === 0) return null;
                const a = p[j - 1];
                if (a.x === pt.x && a.y === pt.y) return null;
                const on =
                  activeEdges.has(edgeKey(a, pt)) ||
                  activeEdges.has(edgeKey(pt, a));
                return (
                  <line
                    key={`${i}-${j}`}
                    x1={a.x}
                    y1={a.y}
                    x2={pt.x}
                    y2={pt.y}
                    stroke={on ? "var(--color-accent)" : "var(--color-faint)"}
                    strokeOpacity={on ? 1 : 0.5}
                    strokeWidth={on ? 2 : 1}
                    strokeDasharray="6 6"
                    className={on ? "animate-dash" : undefined}
                  />
                );
              })}
            </g>
          ))}

          {/* client */}
          <g>
            <rect
              x={10}
              y={118}
              width={120}
              height={64}
              rx={10}
              fill="var(--color-panel-2)"
              stroke="var(--color-line)"
            />
            <text
              x={70}
              y={142}
              textAnchor="middle"
              className="fill-ink font-mono text-[12px]"
            >
              talosctl
            </text>
            <text
              x={70}
              y={160}
              textAnchor="middle"
              className="fill-faint text-[10px]"
            >
              your laptop
            </text>
            <text
              x={70}
              y={174}
              textAnchor="middle"
              className="fill-faint font-mono text-[9px]"
            >
              ~/.talos/config
            </text>
          </g>

          {IDS.map((id) => {
            const n = NODES[id];
            const p = ptsFor(id, info.backend);
            const isTarget = targets.includes(id);
            const isEp = id === endpoint;
            const fail = info.cpOnly && !n.cp;
            return (
              <g key={id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={226}
                  height={124}
                  rx={12}
                  fill="var(--color-panel)"
                  stroke={
                    isTarget
                      ? "var(--color-accent)"
                      : isEp
                        ? "var(--color-accent-2)"
                        : "var(--color-line)"
                  }
                  strokeWidth={isTarget || isEp ? 1.5 : 1}
                />
                <text
                  x={n.x + 10}
                  y={n.y + 18}
                  className="fill-ink text-[11px] font-medium"
                >
                  {n.name}
                </text>
                <text
                  x={n.x + 216}
                  y={n.y + 18}
                  textAnchor="end"
                  className="fill-faint font-mono text-[10px]"
                >
                  {n.ip} {isEp ? "· endpoint" : ""}
                </text>
                <Box
                  x={p.apid.x}
                  y={p.apid.y}
                  label="apid"
                  sub=":50000 mTLS"
                  lit={hit(paths, step, p.apid)}
                  color="var(--color-accent-2)"
                />
                <Box
                  x={p.machined.x}
                  y={p.machined.y}
                  label="machined"
                  sub="PID 1"
                  lit={hit(paths, step, p.machined)}
                  color="var(--color-accent)"
                />
                <g opacity={fail ? 0.35 : 1}>
                  <Box
                    x={p.backend.x}
                    y={p.backend.y}
                    label={fail ? "no etcd" : info.backend}
                    small
                    lit={!fail && hit(paths, step, p.backend)}
                    color="var(--color-f2)"
                  />
                </g>
                <text
                  x={n.x + 52}
                  y={n.y + 112}
                  textAnchor="middle"
                  className="fill-faint text-[9.5px]"
                >
                  {n.cp ? "control plane" : "worker"}
                </text>
              </g>
            );
          })}

          {/* packets */}
          {step >= 0 &&
            paths.map((p, i) => {
              const pt = p[Math.min(step, p.length - 1)];
              const returning = step > Math.floor(p.length / 2) - 1 && step > 3;
              return (
                <g
                  key={i}
                  style={{
                    transform: `translate(${pt.x}px, ${pt.y}px)`,
                    transition: "transform 550ms cubic-bezier(.4,.1,.2,1)",
                  }}
                >
                  <circle
                    r={7}
                    fill={returning ? "var(--color-ok)" : "var(--color-accent)"}
                    opacity={0.25}
                    className="animate-pulse-soft"
                  />
                  <circle
                    r={4}
                    fill={returning ? "var(--color-ok)" : "var(--color-accent)"}
                  />
                </g>
              );
            })}
        </svg>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div
          className="rounded-lg border border-line bg-panel-2/50 p-3 text-sm leading-relaxed text-muted"
          aria-live="polite"
        >
          <div className="mb-1 flex items-center gap-2">
            <Pill color="var(--color-accent)">
              step {Math.max(step + 1, 0)}/{len}
            </Pill>
          </div>
          {narrative}
        </div>
        <Mono className="min-h-24 whitespace-pre">
          {done
            ? invalid.length
              ? `error: ${invalid.map((t) => NODES[t].ip).join(", ")}: etcd is not running on this node (worker)`
              : sampleOutput(cmd, targets)
            : step >= 0
              ? "…waiting for response"
              : "(output appears here)"}
        </Mono>
      </div>
    </div>
  );
}

function edgeKey(a: Pt, b: Pt) {
  return `${a.x},${a.y}>${b.x},${b.y}`;
}

function hit(paths: Pt[][], step: number, pt: Pt) {
  if (step < 0) return false;
  return paths.some((p) => {
    const c = p[Math.min(step, p.length - 1)];
    return c.x === pt.x && c.y === pt.y;
  });
}

function Box({
  x,
  y,
  label,
  sub,
  lit,
  color,
  small,
}: {
  x: number;
  y: number;
  label: string;
  sub?: string;
  lit: boolean;
  color: string;
  small?: boolean;
}) {
  const w = small ? 92 : 96;
  const h = small ? 24 : 36;
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={7}
        fill={
          lit
            ? `color-mix(in srgb, ${color} 22%, var(--color-panel-2))`
            : "var(--color-panel-2)"
        }
        stroke={lit ? color : "var(--color-line)"}
        style={{ transition: "all 300ms" }}
      />
      <text
        x={x}
        y={small ? y + 4 : y - 2}
        textAnchor="middle"
        className="fill-ink font-mono text-[11px]"
      >
        {label}
      </text>
      {sub && (
        <text
          x={x}
          y={y + 11}
          textAnchor="middle"
          className="fill-faint text-[9px]"
        >
          {sub}
        </text>
      )}
    </g>
  );
}
