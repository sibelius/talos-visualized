"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button, Mono, Panel, Pill, Segmented, Stat, Toggle } from "../ui";
import { FLOWS, buildPolicies, byId, evaluate, type Flow, type MonVariant, type SideVerdict, type Verdict } from "./model";
import { policyYaml } from "./yaml";

const BAD_FLOWS = new Set(["fe-db", "tool-api", "db-evil"]);

const POS: Record<string, { x: number; y: number }> = {
  client: { x: 80, y: 95 },
  frontend: { x: 300, y: 120 },
  api: { x: 500, y: 120 },
  db: { x: 500, y: 240 },
  prometheus: { x: 100, y: 430 },
  toolbox: { x: 222, y: 430 },
  dns: { x: 700, y: 430 },
  payments: { x: 822, y: 120 },
  evil: { x: 822, y: 240 },
};
const LABEL_T: Record<string, number> = { "prom-api": 0.35, "tool-api": 0.55, "fe-dns": 0.62, "api-dns": 0.62 };
const HW = 54;
const HH = 19;

const PRESETS: Record<string, { label: string; on: string[] }> = {
  open: { label: "No policies", on: [] },
  ingress: { label: "Ingress lockdown", on: ["deny-in", "allow-web", "fe-api", "api-db", "mon"] },
  dnsless: { label: "Forgot DNS", on: ["deny-in", "allow-web", "fe-api", "api-db", "mon", "deny-eg", "intra", "pay"] },
  zero: { label: "Zero trust", on: ["deny-in", "allow-web", "fe-api", "api-db", "mon", "deny-eg", "dns", "intra", "pay"] },
};

type EdgeState = "ok" | "bad" | "warn";
const COLOR: Record<EdgeState, string> = { ok: "var(--color-ok)", bad: "var(--color-bad)", warn: "var(--color-warn)" };

function clip(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(dx ? HW / Math.abs(dx) : Infinity, dy ? HH / Math.abs(dy) : Infinity) + 0.02;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function PolicySimulator() {
  const [on, setOn] = useState<Set<string>>(new Set(PRESETS.ingress.on));
  const [mon, setMon] = useState<MonVariant>("and");
  const [sel, setSel] = useState<string>("fe-api");
  const [focus, setFocus] = useState<string>("deny-in");

  const all = useMemo(() => buildPolicies(mon), [mon]);
  const active = useMemo(() => all.filter((p) => on.has(p.id)), [all, on]);
  const verdicts = useMemo(() => Object.fromEntries(FLOWS.map((f) => [f.id, evaluate(f, active)])) as Record<string, Verdict>, [active]);

  const dnsBroken = (src: string) => FLOWS.some((f) => f.src === src && f.dst === "dns" && !verdicts[f.id].allowed);
  const stateOf = (f: Flow): EdgeState => {
    const v = verdicts[f.id];
    if (!v.allowed) return "bad";
    if (f.dst !== "dns" && f.dst !== "frontend" && dnsBroken(f.src)) return "warn";
    return "ok";
  };

  const legitBroken = FLOWS.filter((f) => !BAD_FLOWS.has(f.id) && stateOf(f) !== "ok").length;
  const badOpen = FLOWS.filter((f) => BAD_FLOWS.has(f.id) && verdicts[f.id].allowed).length;

  const toggle = (id: string, v: boolean) => {
    setOn((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
    setFocus(id);
  };

  const flow = FLOWS.find((f) => f.id === sel)!;
  const v = verdicts[sel];
  const selState = stateOf(flow);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Panel
          title="Cluster traffic — click any arrow"
          right={
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PRESETS).map(([k, p]) => (
                <Button key={k} variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setOn(new Set(p.on))}>
                  {p.label}
                </Button>
              ))}
            </div>
          }
        >
          <svg viewBox="0 0 900 510" className="w-full" role="img" aria-label="Graph of pods and the network flows between them">
            <defs>
              {(Object.keys(COLOR) as EdgeState[]).map((k) => (
                <marker key={k} id={`np-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" style={{ fill: COLOR[k] }} />
                </marker>
              ))}
            </defs>

            {/* namespaces */}
            <NsBox x={222} y={50} w={500} h={240} label="namespace: shop" />
            <NsBox x={24} y={370} w={278} h={118} label="namespace: monitoring" />
            <NsBox x={598} y={370} w={204} h={118} label="namespace: kube-system" />
            <text x={20} y={30} className="fill-faint font-mono text-[11px]">outside the cluster ↓</text>
            <text x={880} y={30} textAnchor="end" className="fill-faint font-mono text-[11px]">outside the cluster ↓</text>

            {/* edges */}
            {FLOWS.map((f) => {
              const a = clip(POS[f.src], POS[f.dst]);
              const b = clip(POS[f.dst], POS[f.src]);
              const st = stateOf(f);
              const vv = verdicts[f.id];
              const t = LABEL_T[f.id] ?? 0.5;
              const lx = a.x + (b.x - a.x) * t;
              const ly = a.y + (b.y - a.y) * t;
              // where is it dropped? egress → near source, ingress → near destination
              const dropT = !vv.egress.allowed ? 0.12 : 0.86;
              const xx = a.x + (b.x - a.x) * dropT;
              const xy = a.y + (b.y - a.y) * dropT;
              const active = f.id === sel;
              const short = f.label.replace("DNS ", "");
              return (
                <g
                  key={f.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${byId[f.src].name} to ${byId[f.dst].name} ${f.label}: ${vv.allowed ? "allowed" : "denied"}`}
                  onClick={() => setSel(f.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(f.id)}
                  className="cursor-pointer outline-none"
                >
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={16} />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    style={{ stroke: COLOR[st], transition: "stroke 300ms, opacity 300ms" }}
                    strokeWidth={active ? 3 : 1.6}
                    opacity={active ? 1 : 0.75}
                    strokeDasharray={st === "ok" ? "6 6" : st === "warn" ? "2 5" : undefined}
                    className={st === "ok" ? "animate-dash" : undefined}
                    markerEnd={`url(#np-arrow-${st})`}
                  />
                  {st === "bad" && (
                    <g transform={`translate(${xx} ${xy})`} style={{ stroke: "var(--color-bad)" }} strokeWidth={2.5} strokeLinecap="round">
                      <circle r={8} style={{ fill: "var(--color-bg)" }} strokeWidth={1.5} />
                      <path d="M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5" />
                    </g>
                  )}
                  <g transform={`translate(${lx} ${ly})`}>
                    <rect
                      x={-short.length * 3.3 - 5}
                      y={-8}
                      width={short.length * 6.6 + 10}
                      height={16}
                      rx={4}
                      style={{ fill: "var(--color-panel)", stroke: active ? COLOR[st] : "var(--color-line)" }}
                    />
                    <text textAnchor="middle" y={3.5} className="font-mono text-[10px]" style={{ fill: COLOR[st] }}>
                      {short}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* nodes */}
            {Object.entries(POS).map(([id, p]) => {
              const e = byId[id];
              const pod = e.kind === "pod";
              const involved = flow.src === id || flow.dst === id;
              return (
                <g key={id} transform={`translate(${p.x} ${p.y})`}>
                  <rect
                    x={-HW}
                    y={-HH}
                    width={HW * 2}
                    height={HH * 2}
                    rx={pod ? 8 : 19}
                    strokeDasharray={pod ? undefined : "4 3"}
                    style={{
                      fill: "var(--color-panel-2)",
                      stroke: involved ? "var(--color-accent)" : "var(--color-line)",
                      transition: "stroke 200ms",
                    }}
                    strokeWidth={involved ? 2 : 1}
                  />
                  <text textAnchor="middle" y={-2} className="fill-ink text-[12px] font-medium">
                    {e.name}
                  </text>
                  <text textAnchor="middle" y={11} className="fill-faint font-mono text-[9px]">
                    {e.kind === "pod" ? Object.entries(e.labels).map(([k, v]) => `${k}=${v}`)[0] : e.ip}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
            <span><span className="text-ok">━ ━</span> allowed</span>
            <span><span className="text-bad">━━ ⊗</span> dropped (⊗ sits at the side that drops it)</span>
            <span><span className="text-warn">┅┅</span> allowed by policy, but the pod can&apos;t resolve the name</span>
          </div>
        </Panel>

        <Panel title="Why?" right={<Pill color={COLOR[selState]}>{selState === "bad" ? "DENIED" : selState === "warn" ? "ALLOWED, BUT DNS FAILS" : "ALLOWED"}</Pill>}>
          <div key={sel} className="animate-rise space-y-3">
            <div>
              <div className="font-mono text-sm text-ink">
                {byId[flow.src].name} → {byId[flow.dst].name} <span className="text-faint">{flow.port}/{flow.protocol}</span>
                {BAD_FLOWS.has(flow.id) && <span className="ml-2 text-xs text-warn">(should be blocked)</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{flow.why}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <SideCard title={`① egress from ${byId[flow.src].name}`} s={v.egress} dir="egress" />
              <SideCard title={`② ingress to ${byId[flow.dst].name}`} s={v.ingress} dir="ingress" />
            </div>
            {selState === "warn" && (
              <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
                Policy-wise this connection is fine — but {byId[flow.src].name} can&apos;t reach CoreDNS, so it never learns the IP to connect
                to. In real life you see timeouts like <span className="font-mono">dial tcp: lookup {flow.dst}.shop.svc: i/o timeout</span>.
              </p>
            )}
            <p className="text-xs text-faint">A connection succeeds only if <b className="text-muted">both</b> ① and ② allow it. Replies on an allowed connection are let through automatically (policies are stateful).</p>
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="legit flows broken" value={legitBroken} tone={legitBroken ? "bad" : "good"} />
          <Stat label="bad flows open" value={badOpen} tone={badOpen ? "warn" : "good"} />
        </div>
        <Panel title="Policies in effect">
          <div className="space-y-4">
            <PolicyGroup title="Ingress" ids={["deny-in", "allow-web", "fe-api", "api-db", "mon"]} {...{ all, on, toggle, focus, setFocus, v }}>
              {(id) =>
                id === "mon" && (
                  <div className="mt-1.5 ml-11 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                    from:
                    <Segmented
                      value={mon}
                      onChange={(m) => {
                        setMon(m);
                        setFocus("mon");
                      }}
                      options={[
                        { value: "and", label: "AND · 1 item" },
                        { value: "or", label: "OR · 2 items" },
                      ]}
                    />
                  </div>
                )
              }
            </PolicyGroup>
            <PolicyGroup title="Egress" ids={["deny-eg", "dns", "intra", "pay"]} {...{ all, on, toggle, focus, setFocus, v }} />
          </div>
        </Panel>
        <Panel title={<>YAML · {all.find((p) => p.id === focus)?.name}</>}>
          <Mono className="max-h-80 text-[11.5px]">{policyYaml(focus, mon)}</Mono>
        </Panel>
      </div>
    </div>
  );
}

function NsBox({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} style={{ fill: "color-mix(in srgb, var(--color-accent-2) 5%, transparent)", stroke: "var(--color-line)" }} />
      <text x={x + 10} y={y + 16} className="fill-faint font-mono text-[10px]">
        {label}
      </text>
    </g>
  );
}

function SideCard({ title, s, dir }: { title: string; s: SideVerdict; dir: "ingress" | "egress" }) {
  let tone: "ok" | "bad" | "muted" = "ok";
  let body: ReactNode;
  if (!s.enforced) {
    tone = "muted";
    body = <>Not a pod — NetworkPolicy only governs pods. Nothing to check on this side.</>;
  } else if (!s.isolated) {
    body = (
      <>
        No policy selects this pod for <b>{dir}</b>, so it is <b>not isolated</b> for {dir}: everything is allowed by default.
      </>
    );
  } else if (s.allowed) {
    body = (
      <>
        Isolated by {s.selecting.length} polic{s.selecting.length > 1 ? "ies" : "y"}. Allowed because{" "}
        {s.allowedBy.map((n, i) => (
          <span key={n}>
            {i > 0 && " and "}
            <span className="font-mono text-ok">{n}</span>
          </span>
        ))}{" "}
        has a matching rule.
      </>
    );
  } else {
    tone = "bad";
    body = (
      <>
        Isolated for {dir} by{" "}
        {s.selecting.map((n, i) => (
          <span key={n}>
            {i > 0 && ", "}
            <span className="font-mono text-ink">{n}</span>
          </span>
        ))}
        , and <b>no rule</b> in any of them matches this peer + port → dropped. (Deny = absence of an allow; there is no explicit deny rule in NetworkPolicy.)
      </>
    );
  }
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-xs leading-relaxed text-muted",
        tone === "ok" && "border-ok/40 bg-ok/5",
        tone === "bad" && "border-bad/40 bg-bad/5",
        tone === "muted" && "border-line bg-panel-2/50",
      )}
    >
      <div className={clsx("mb-1 font-medium", tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-faint")}>
        {title}: {tone === "bad" ? "denied" : tone === "muted" ? "n/a" : "allowed"}
      </div>
      {body}
    </div>
  );
}

function PolicyGroup({
  title,
  ids,
  all,
  on,
  toggle,
  focus,
  setFocus,
  v,
  children,
}: {
  title: string;
  ids: string[];
  all: ReturnType<typeof buildPolicies>;
  on: Set<string>;
  toggle: (id: string, v: boolean) => void;
  focus: string;
  setFocus: (id: string) => void;
  v: Verdict;
  children?: (id: string) => ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] tracking-wide text-faint uppercase">{title}</div>
      <ul className="space-y-2">
        {ids.map((id) => {
          const p = all.find((x) => x.id === id)!;
          const allows = [...v.egress.allowedBy, ...v.ingress.allowedBy].includes(p.name);
          const isolates = !allows && [...v.egress.selecting, ...v.ingress.selecting].includes(p.name);
          return (
            <li
              key={id}
              className={clsx(
                "rounded-lg border px-2 py-1.5 transition",
                focus === id ? "border-accent/50 bg-panel-2" : "border-transparent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Toggle checked={on.has(id)} onChange={(c) => toggle(id, c)} label={<span className="font-mono text-[12px] text-ink">{p.name}</span>} />
                <div className="flex items-center gap-1">
                  {allows && <span className="text-[10px] text-ok" title="allows the selected flow">allows ✓</span>}
                  {isolates && <span className="text-[10px] text-faint" title="selects a pod of the selected flow">isolates</span>}
                  <button
                    type="button"
                    onClick={() => setFocus(id)}
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] text-faint hover:bg-panel hover:text-ink"
                    aria-label={`Show YAML for ${p.name}`}
                  >
                    yaml
                  </button>
                </div>
              </div>
              {children?.(id)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
