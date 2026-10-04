"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Pill, Segmented, Toggle } from "../ui";

type App = "world" | "frontend" | "backend" | "db" | "debug";

const IDS: Record<App, { id: number; labels: string[]; color: string }> = {
  world: { id: 2, labels: ["reserved:world"], color: "var(--color-muted)" },
  frontend: { id: 48211, labels: ["k8s:app=frontend", "k8s:io.kubernetes.pod.namespace=shop"], color: "var(--color-f1)" },
  backend: { id: 51002, labels: ["k8s:app=backend", "k8s:io.kubernetes.pod.namespace=shop"], color: "var(--color-f2)" },
  db: { id: 23817, labels: ["k8s:app=db", "k8s:io.kubernetes.pod.namespace=shop"], color: "var(--color-f4)" },
  debug: { id: 60433, labels: ["k8s:app=debug", "k8s:io.kubernetes.pod.namespace=shop"], color: "var(--color-f5)" },
};

type Pod = { app: App; name: string; ip: string };

type Verdict = "FORWARDED" | "DROPPED";
type Flow = { n: number; t: string; src: Pod; dst: Pod; port: number; l7?: string; verdict: Verdict; reason: string };

// The policy, evaluated on identities only
function decide(src: App, dst: App, port: number, l7?: string): { verdict: Verdict; reason: string } {
  if (dst === "frontend") return src === "world" && port === 80 ? ok("to-endpoint (TCP Flags: SYN)") : deny();
  if (dst === "backend") {
    if (src !== "frontend" || port !== 8080) return deny();
    if (l7 && !/^GET \/api\//.test(l7)) return { verdict: "DROPPED", reason: `http-request (${l7}) → 403 Forbidden, L7 policy` };
    return ok(l7 ? `http-request (HTTP/1.1 ${l7})` : "to-endpoint (TCP Flags: SYN)");
  }
  if (dst === "db") return src === "backend" && port === 5432 ? ok("to-endpoint (TCP Flags: SYN)") : deny();
  return deny();
  function ok(r: string) {
    return { verdict: "FORWARDED" as const, reason: r };
  }
  function deny() {
    return { verdict: "DROPPED" as const, reason: "policy-verdict:none INGRESS DENIED (Policy denied)" };
  }
}

const PORTS: Record<App, number> = { world: 0, frontend: 80, backend: 8080, db: 5432, debug: 22 };
const L7 = ["GET /api/cart", "GET /api/items/42", "POST /admin/reset", "GET /api/health", "DELETE /api/cart"];

const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const suffix = () => Math.random().toString(36).slice(2, 7);

function initialPods(): Pod[] {
  return [
    { app: "world", name: "203.0.113.50", ip: "203.0.113.50" },
    { app: "frontend", name: "frontend-7d9f-x2kq4", ip: "10.244.1.17" },
    { app: "frontend", name: "frontend-7d9f-m8z1p", ip: "10.244.2.31" },
    { app: "backend", name: "backend-5c8b-k1d0s", ip: "10.244.1.22" },
    { app: "backend", name: "backend-5c8b-w9t3r", ip: "10.244.3.8" },
    { app: "db", name: "db-0", ip: "10.244.3.12" },
    { app: "debug", name: "debug-shell", ip: "10.244.2.44" },
  ];
}

export function IdentityHubble({ policyCode }: { policyCode?: ReactNode }) {
  const [pods, setPods] = useState<Pod[]>(initialPods);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<"all" | "DROPPED">("all");
  const [src, setSrc] = useState<App>("debug");
  const [dst, setDst] = useState<App>("db");
  const [flash, setFlash] = useState<string | null>(null);
  const nRef = useRef(0);
  const podsRef = useRef(pods);
  useEffect(() => {
    podsRef.current = pods;
  }, [pods]);

  const emit = useCallback((s: App, d: App) => {
    const ps = podsRef.current;
    const sp = rand(ps.filter((p) => p.app === s));
    const dp = rand(ps.filter((p) => p.app === d));
    if (!sp || !dp) return;
    const port = PORTS[d];
    const l7 = d === "backend" && s === "frontend" ? rand(L7) : undefined;
    const v = decide(s, d, port, l7);
    const now = new Date();
    const t = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
    setFlows((f) => [{ n: ++nRef.current, t, src: sp, dst: dp, port, l7, ...v }, ...f].slice(0, 40));
  }, []);

  // seed the log so it isn't empty on first paint
  useEffect(() => {
    const seed: [App, App][] = [["world", "frontend"], ["frontend", "backend"], ["backend", "db"], ["debug", "db"], ["frontend", "backend"], ["frontend", "db"]];
    seed.forEach(([a, b]) => emit(a, b));
  }, [emit]);

  useEffect(() => {
    if (!live) return;
    const pairs: [App, App][] = [
      ["world", "frontend"], ["world", "frontend"], ["frontend", "backend"], ["frontend", "backend"], ["frontend", "backend"],
      ["backend", "db"], ["backend", "db"], ["frontend", "db"], ["debug", "backend"], ["world", "db"],
    ];
    const t = setInterval(() => {
      const [a, b] = rand(pairs);
      emit(a, b);
    }, 1100);
    return () => clearInterval(t);
  }, [live, emit]);

  function scale() {
    const node = 1 + Math.floor(Math.random() * 3);
    const p: Pod = { app: "frontend", name: `frontend-7d9f-${suffix()}`, ip: `10.244.${node}.${50 + Math.floor(Math.random() * 150)}` };
    setPods((ps) => [...ps, p]);
    setFlash(p.name);
  }

  const shown = flows.filter((f) => filter === "all" || f.verdict === "DROPPED");
  const nFront = pods.filter((p) => p.app === "frontend").length;
  const apps: App[] = ["world", "frontend", "backend", "db", "debug"];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="text-[11px] tracking-wide text-faint uppercase">endpoints → security identities</div>
          <div className="space-y-2">
            {apps.map((a) => {
              const meta = IDS[a];
              const mine = pods.filter((p) => p.app === a);
              return (
                <div key={a} className="rounded-lg border border-line bg-panel-2/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold text-bg" style={{ background: meta.color }}>
                      ID {meta.id}
                    </span>
                    {meta.labels.map((l) => (
                      <span key={l} className="font-mono text-[10.5px] text-faint">{l}</span>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {mine.map((p) => (
                      <span
                        key={p.name}
                        className={clsx("rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10.5px] text-muted", flash === p.name && "animate-flash")}
                      >
                        {a === "world" ? "any external IP" : <>{p.name.split("-").slice(0, 1)}… <span style={{ color: meta.color }}>{p.ip}</span></>}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={scale}>+ scale frontend ({nFront})</Button>
            <span className="text-[12px] text-faint">
              {flash ? "New IP, same identity 48211 — no policy map change on any node." : "New pods reuse their label set's identity."}
            </span>
          </div>
          {policyCode}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-faint">$ hubble observe -n shop --follow</span>
            <div className="ml-auto flex items-center gap-3">
              <Segmented value={filter} options={[{ value: "all", label: "all" }, { value: "DROPPED", label: "--verdict DROPPED" }]} onChange={setFilter} />
              <Toggle checked={live} onChange={setLive} label="live" />
            </div>
          </div>
          <div className="h-[380px] overflow-hidden rounded-lg border border-line bg-bg p-2" aria-live="off">
            {shown.length === 0 && <div className="p-4 text-center text-sm text-faint">waiting for flows…</div>}
            {shown.map((f) => (
              <div key={f.n} className="animate-rise border-b border-line/50 py-1 font-mono text-[10.5px] leading-snug">
                <span className="text-faint">{f.t} </span>
                <span style={{ color: IDS[f.src.app].color }}>{f.src.app === "world" ? f.src.ip : `shop/${f.src.name}`}</span>
                <span className="text-faint"> (ID:{IDS[f.src.app].id}) → </span>
                <span style={{ color: IDS[f.dst.app].color }}>shop/{f.dst.name}:{f.port}</span>
                <span className="text-faint"> (ID:{IDS[f.dst.app].id}) </span>
                <span className={clsx("font-semibold", f.verdict === "FORWARDED" ? "text-ok" : "text-bad")}>{f.verdict}</span>
                <span className="text-muted"> {f.reason}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2/40 p-2">
            <span className="text-xs text-muted">send</span>
            <select value={src} onChange={(e) => setSrc(e.target.value as App)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs" aria-label="source">
              {apps.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-xs text-faint">→</span>
            <select value={dst} onChange={(e) => setDst(e.target.value as App)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs" aria-label="destination">
              {apps.filter((a) => a !== "world").map((a) => <option key={a} value={a}>{a} :{PORTS[a]}</option>)}
            </select>
            <Button variant="primary" onClick={() => emit(src, dst)}>Send</Button>
            {(() => {
              const v = decide(src, dst, PORTS[dst], dst === "backend" && src === "frontend" ? "GET /api/cart" : undefined);
              return <Pill color={v.verdict === "FORWARDED" ? "var(--color-ok)" : "var(--color-bad)"}>expect {v.verdict}</Pill>;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

